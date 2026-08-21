import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizedAnimeStatus");
const end = source.indexOf("function applyDiscoverFilters");
assert.ok(start >= 0 && end > start, "discover filter helpers must remain available for testing");

const context = vm.createContext({
  String,
  Number,
  releaseTime: (anime) => anime.time,
  console
});
vm.runInContext(source.slice(start, end), context);

const anime = { title: "Moon Story", genres: ["Fantasy", "Drama"], format: "TV", status: "Currently Airing", season: "SPRING", year: 2026, score: 8.4, time: 20 };
assert.equal(context.animeMatchesDiscoverFilters(anime, { genre: "Fantasy", format: "TV", status: "RELEASING", season: "SPRING", year: "2026", minScore: "8" }), true);
assert.equal(context.animeMatchesDiscoverFilters(anime, { genre: "Comedy", format: "all", status: "all", season: "all", year: "all", minScore: "0" }), false);
assert.equal(context.animeMatchesDiscoverFilters(anime, { genre: "All", format: "MOVIE", status: "all", season: "all", year: "all", minScore: "0" }), false);
assert.equal(context.normalizedAnimeStatus("Finished Airing"), "FINISHED");
assert.deepEqual(Array.from(context.sortDiscoverAnime([{ title: "Z", score: 7, time: 10 }, { title: "A", score: 9, time: 20 }], "title"), (item) => item.title), ["A", "Z"]);
assert.deepEqual(Array.from(context.sortDiscoverAnime([{ title: "Z", score: 7, time: 10 }, { title: "A", score: 9, time: 20 }], "rating"), (item) => item.score), [9, 7]);

const queryStart = source.indexOf("function buildDiscoverQuery");
const queryEnd = source.indexOf("function renderDiscoverFilterControls");
const queryContext = vm.createContext({ ANILIST_MEDIA_FIELDS: "id title { romaji }", Number });
vm.runInContext(source.slice(queryStart, queryEnd), queryContext);
const request = queryContext.buildDiscoverQuery({ genre: "Fantasy", format: "TV", status: "all", season: "all", year: "all", minScore: "7", sort: "rating" });
assert.match(request.query, /genre: \$genre/);
assert.match(request.query, /format: \$format/);
assert.match(request.query, /averageScore_greater: \$minimumScore/);
assert.doesNotMatch(request.query, /status: \$status/);
assert.doesNotMatch(request.query, /seasonYear: \$year/);
assert.equal(request.variables.minimumScore, 69);

console.log("Discover filter checks passed");
