(function () {
  "use strict";

  let client = null;
  let session = null;
  let realtimeChannel = null;

  function requireClient() {
    if (!client) throw new Error("Supabase has not finished connecting.");
    return client;
  }

  function throwIfError(result) {
    if (result?.error) throw result.error;
    return result?.data;
  }

  function currentUserId() {
    return session?.user?.id || null;
  }

  function statusFromDatabase(status) {
    return status === "plan" ? "planned" : status;
  }

  function statusToDatabase(status) {
    return status === "planned" ? "plan" : status;
  }

  async function initialize() {
    if (client) return session;
    const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("The Supabase configuration could not be loaded.");
    const config = await response.json();
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error("Supabase is not configured on this server.");
    if (!window.supabase?.createClient) throw new Error("The Supabase browser library could not be loaded.");

    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const result = await client.auth.getSession();
    throwIfError(result);
    session = result.data.session;
    return session;
  }

  function onAuthStateChange(callback) {
    return requireClient().auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      window.setTimeout(() => callback(nextSession, event), 0);
    });
  }

  function subscribeToChanges(callback) {
    if (realtimeChannel) requireClient().removeChannel(realtimeChannel);
    if (!session) return null;
    let timer = null;
    realtimeChannel = requireClient()
      .channel(`soralist-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public" }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(callback, 180);
      })
      .subscribe();
    return realtimeChannel;
  }

  async function querySnapshot() {
    if (!session) return null;
    const db = requireClient();
    const results = await Promise.all([
      db.from("profiles").select("id,username,display_name,bio,avatar_url,region,preferences,created_at"),
      db.from("anime_list_entries").select("id,user_id,anime_id,status,episodes_watched,rating,snapshot,added_at,updated_at"),
      db.from("friend_requests").select("id,requester_id,recipient_id,created_at"),
      db.from("friendships").select("user_a,user_b,created_at"),
      db.from("rejected_friend_requests").select("owner_id,rejected_user_id,rejected_at"),
      db.from("groups").select("id,owner_id,name,created_at,updated_at").order("updated_at", { ascending: false }),
      db.from("group_members").select("group_id,user_id,role,joined_at"),
      db.from("group_anime_entries").select("group_id,anime_id,snapshot,created_by,created_at,updated_at"),
      db.from("group_anime_interests").select("group_id,anime_id,user_id,created_at"),
      db.from("group_messages").select("id,group_id,author_id,body,system,created_at").order("created_at", { ascending: true }).limit(1000)
    ]);
    results.forEach(throwIfError);
    return {
      profiles: results[0].data || [],
      listEntries: results[1].data || [],
      friendRequests: results[2].data || [],
      friendships: results[3].data || [],
      rejectedRequests: results[4].data || [],
      groups: results[5].data || [],
      groupMembers: results[6].data || [],
      groupAnimeEntries: results[7].data || [],
      groupAnimeInterests: results[8].data || [],
      groupMessages: results[9].data || []
    };
  }

  async function loadLegacyStore(previousStore) {
    const data = await querySnapshot();
    if (!data || !session) return null;
    const profileById = new Map();
    const users = data.profiles.map((profile) => {
      const preferences = profile.preferences || {};
      const user = {
        dbId: profile.id,
        username: profile.username,
        usernameLower: profile.username.toLowerCase(),
        displayName: profile.display_name || profile.username,
        bio: profile.bio || "",
        location: preferences.location || "",
        customAvatarUrl: profile.avatar_url || null,
        avatarUrl: profile.avatar_url || null,
        createdAt: profile.created_at,
        friends: [],
        incomingFriendRequests: [],
        outgoingFriendRequests: [],
        rejectedFriendRequests: [],
        incomingFriendRequestIds: {},
        outgoingFriendRequestIds: {},
        list: []
      };
      profileById.set(profile.id, user);
      return user;
    });

    const signedInProfile = profileById.get(session.user.id);
    if (!signedInProfile) throw new Error("Your authenticated account does not have a profile row.");
    const providers = session.user.app_metadata?.providers || [];
    signedInProfile.email = session.user.email || null;
    signedInProfile.authProvider = session.user.app_metadata?.provider || providers[0] || null;
    signedInProfile.identities = providers.map((provider) => `${provider}:supabase`);
    signedInProfile.supabaseAccount = true;
    signedInProfile.hasPassword = providers.includes("email");

    data.listEntries.forEach((row) => {
      const owner = profileById.get(row.user_id);
      if (!owner) return;
      owner.list.push({
        dbId: row.id,
        animeId: Number(row.anime_id),
        status: statusFromDatabase(row.status),
        progress: Number(row.episodes_watched) || 0,
        rating: row.rating === null ? 0 : Number(row.rating),
        snapshot: row.snapshot || null,
        addedAt: row.added_at,
        updatedAt: row.updated_at
      });
    });

    data.friendships.forEach((row) => {
      const left = profileById.get(row.user_a);
      const right = profileById.get(row.user_b);
      if (!left || !right) return;
      left.friends.push(right.usernameLower);
      right.friends.push(left.usernameLower);
    });

    data.friendRequests.forEach((row) => {
      const requester = profileById.get(row.requester_id);
      const recipient = profileById.get(row.recipient_id);
      if (!requester || !recipient) return;
      requester.outgoingFriendRequests.push(recipient.usernameLower);
      requester.outgoingFriendRequestIds[recipient.usernameLower] = row.id;
      recipient.incomingFriendRequests.push(requester.usernameLower);
      recipient.incomingFriendRequestIds[requester.usernameLower] = row.id;
    });

    data.rejectedRequests.forEach((row) => {
      const owner = profileById.get(row.owner_id);
      const rejected = profileById.get(row.rejected_user_id);
      if (owner && rejected) owner.rejectedFriendRequests.push(rejected.usernameLower);
    });

    const groups = data.groups.map((row) => {
      const owner = profileById.get(row.owner_id);
      return {
        id: row.id,
        name: row.name,
        ownerUsernameLower: owner?.usernameLower || "",
        memberUsernames: [],
        animeEntries: [],
        messages: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
    const groupById = new Map(groups.map((group) => [group.id, group]));

    data.groupMembers.forEach((row) => {
      const group = groupById.get(row.group_id);
      const member = profileById.get(row.user_id);
      if (group && member) group.memberUsernames.push(member.usernameLower);
    });

    data.groupAnimeEntries.forEach((row) => {
      const group = groupById.get(row.group_id);
      if (!group) return;
      group.animeEntries.push({
        animeId: Number(row.anime_id),
        snapshot: row.snapshot || null,
        addedBy: [],
        addedAt: row.created_at
      });
    });

    data.groupAnimeInterests.forEach((row) => {
      const group = groupById.get(row.group_id);
      const member = profileById.get(row.user_id);
      const entry = group?.animeEntries.find((item) => Number(item.animeId) === Number(row.anime_id));
      if (entry && member) entry.addedBy.push(member.usernameLower);
    });

    data.groupMessages.forEach((row) => {
      const group = groupById.get(row.group_id);
      const author = profileById.get(row.author_id);
      if (!group) return;
      group.messages.push({
        id: row.id,
        authorUsernameLower: author?.usernameLower || "unknown",
        text: row.body,
        system: Boolean(row.system),
        createdAt: row.created_at
      });
    });

    const preferences = signedInProfile ? data.profiles.find((profile) => profile.id === signedInProfile.dbId)?.preferences || {} : {};
    return {
      ...previousStore,
      users,
      groups,
      session: signedInProfile.usernameLower,
      region: signedInProfile ? data.profiles.find((profile) => profile.id === signedInProfile.dbId)?.region || previousStore.region : previousStore.region,
      theme: preferences.theme || previousStore.theme,
      density: preferences.density || previousStore.density,
      reduceMotion: preferences.reduceMotion ?? previousStore.reduceMotion,
      alwaysShowListControls: preferences.alwaysShowListControls ?? previousStore.alwaysShowListControls
    };
  }

  async function signUp(email, password, username) {
    return throwIfError(await requireClient().auth.signUp({
      email,
      password,
      options: { data: { user_name: username, display_name: username } }
    }));
  }

  async function signIn(email, password) {
    return throwIfError(await requireClient().auth.signInWithPassword({ email, password }));
  }

  async function signInWithOAuth(provider, redirectTo = window.location.origin) {
    return throwIfError(await requireClient().auth.signInWithOAuth({ provider, options: { redirectTo } }));
  }

  async function linkIdentity(provider, redirectTo = window.location.origin) {
    return throwIfError(await requireClient().auth.linkIdentity({ provider, options: { redirectTo } }));
  }

  async function unlinkIdentity(provider) {
    const userResult = await requireClient().auth.getUser();
    throwIfError(userResult);
    const identity = userResult.data.user?.identities?.find((item) => item.provider === provider);
    if (!identity) throw new Error(`${provider} is not connected.`);
    return throwIfError(await requireClient().auth.unlinkIdentity(identity));
  }

  async function signOut() {
    const result = await requireClient().auth.signOut();
    throwIfError(result);
    session = null;
  }

  async function sendPasswordReset(email, redirectTo = window.location.origin) {
    return throwIfError(await requireClient().auth.resetPasswordForEmail(email, { redirectTo }));
  }

  async function updatePassword(password) {
    return throwIfError(await requireClient().auth.updateUser({ password }));
  }

  async function updateProfile(values) {
    const userId = currentUserId();
    if (!userId) throw new Error("Authentication required.");
    return throwIfError(await requireClient().from("profiles").update(values).eq("id", userId).select().single());
  }

  async function uploadAvatar(dataUrl) {
    const userId = currentUserId();
    if (!userId) throw new Error("Authentication required.");
    const blob = await fetch(dataUrl).then((response) => response.blob());
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/avatar.${extension}`;
    throwIfError(await requireClient().storage.from("avatars").upload(path, blob, { contentType: blob.type, upsert: true }));
    return requireClient().storage.from("avatars").getPublicUrl(path).data.publicUrl;
  }

  async function savePreferences(preferences, region) {
    return updateProfile({ preferences, region });
  }

  async function upsertListEntry(entry) {
    const userId = currentUserId();
    if (!userId) throw new Error("Authentication required.");
    return throwIfError(await requireClient().from("anime_list_entries").upsert({
      user_id: userId,
      anime_id: Number(entry.animeId),
      status: statusToDatabase(entry.status),
      episodes_watched: Number(entry.progress) || 0,
      rating: Number(entry.rating) || null,
      snapshot: entry.snapshot || {}
    }, { onConflict: "user_id,anime_id" }).select().single());
  }

  async function deleteListEntry(animeId) {
    const userId = currentUserId();
    if (!userId) throw new Error("Authentication required.");
    return throwIfError(await requireClient().from("anime_list_entries").delete().eq("user_id", userId).eq("anime_id", Number(animeId)));
  }

  async function sendFriendRequest(username) {
    return throwIfError(await requireClient().rpc("send_friend_request", { target_username: username }));
  }

  async function respondToFriendRequest(requestId, accept) {
    return throwIfError(await requireClient().rpc("respond_to_friend_request", { request_id: requestId, accept_request: accept }));
  }

  async function cancelFriendRequest(requestId) {
    return throwIfError(await requireClient().rpc("cancel_friend_request", { request_id: requestId }));
  }

  async function removeFriend(username) {
    return throwIfError(await requireClient().rpc("remove_friend", { friend_username: username }));
  }

  async function dismissRejectedFriend(userId) {
    const ownerId = currentUserId();
    if (!ownerId) throw new Error("Authentication required.");
    return throwIfError(await requireClient().from("rejected_friend_requests").delete().eq("owner_id", ownerId).eq("rejected_user_id", userId));
  }

  async function createGroup(name, memberIds) {
    const ownerId = currentUserId();
    if (!ownerId) throw new Error("Authentication required.");
    const group = throwIfError(await requireClient().from("groups").insert({ owner_id: ownerId, name }).select().single());
    const members = [...new Set([ownerId, ...memberIds])].map((userId) => ({
      group_id: group.id,
      user_id: userId,
      role: userId === ownerId ? "owner" : "member"
    }));
    try {
      throwIfError(await requireClient().from("group_members").insert(members));
    } catch (error) {
      await requireClient().from("groups").delete().eq("id", group.id);
      throw error;
    }
    return group;
  }

  async function setGroupAnimeInterest(groupId, animeId, snapshot, interested) {
    return throwIfError(await requireClient().rpc("set_group_anime_interest", {
      target_group: groupId,
      target_anime: Number(animeId),
      anime_snapshot: snapshot || {},
      interested: Boolean(interested)
    }));
  }

  async function sendGroupMessage(groupId, body) {
    const authorId = currentUserId();
    if (!authorId) throw new Error("Authentication required.");
    return throwIfError(await requireClient().from("group_messages").insert({
      group_id: groupId,
      author_id: authorId,
      body: body.slice(0, 500),
      system: false
    }));
  }

  window.SoraListSupabase = {
    initialize,
    onAuthStateChange,
    subscribeToChanges,
    loadLegacyStore,
    signUp,
    signIn,
    signInWithOAuth,
    linkIdentity,
    unlinkIdentity,
    signOut,
    sendPasswordReset,
    updatePassword,
    updateProfile,
    uploadAvatar,
    savePreferences,
    upsertListEntry,
    deleteListEntry,
    sendFriendRequest,
    respondToFriendRequest,
    cancelFriendRequest,
    removeFriend,
    dismissRejectedFriend,
    createGroup,
    setGroupAnimeInterest,
    sendGroupMessage,
    get session() { return session; },
    get connected() { return Boolean(client); }
  };
}());
