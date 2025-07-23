import admin from "firebase-admin";
import fs from "fs/promises";
import axios from "axios";

const serviceAccount = JSON.parse(
  await fs.readFile("serviceAccountKey.json", "utf-8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://language-fire-default-rtdb.firebaseio.com",
});

const db = admin.database();

// Sanitize keyword to make valid Firebase DB path key
function sanitizeKey(key) {
  return key.replace(/[.#$/\[\]]/g, "_").replace(/\s+/g, "_");
}

async function readKeywords() {
  const snapshot = await db.ref("keywords").once("value");
  const data = snapshot.val();
  if (!data) {
    console.log("No keywords found.");
    return [];
  }
  return Object.values(data);
}

async function saveResult(keyword, apiName, data) {
  const safeKeyword = sanitizeKey(keyword);
  await db.ref(`results/${safeKeyword}/${apiName}`).set(data);
}

// Delay helper to wait n ms
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to check if API returned meaningful data
function hasMeaningfulData(data) {
  if (!data) return false;

  if (Array.isArray(data)) {
    return data.length > 0;
  }

  if (typeof data === "object") {
    return Object.keys(data).some(
      (k) =>
        data[k] !== null &&
        data[k] !== undefined &&
        (typeof data[k] !== "string" || data[k].trim() !== "")
    );
  }

  return Boolean(data);
}

// API fetchers:

// Updated Wikipedia fetcher with search fallback for approximate titles
async function fetchFromWikipedia(keyword) {
  try {
    // Step 1: Search Wikipedia for closest matches
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      keyword
    )}&format=json&origin=*`;

    const searchRes = await axios.get(searchUrl);
    const searchResults = searchRes.data.query.search;

    if (!searchResults || searchResults.length === 0) {
      console.error(`Wikipedia search found no results for "${keyword}"`);
      return null;
    }

    // Step 2: Pick the first search result's title
    const closestTitle = searchResults[0].title;

    // Step 3: Fetch summary for that title
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      closestTitle
    )}`;

    const summaryRes = await axios.get(summaryUrl);

    return {
      title: summaryRes.data.title,
      extract: summaryRes.data.extract,
      url: summaryRes.data.content_urls?.desktop.page || "",
    };
  } catch (e) {
    console.error(`Wikipedia error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromReddit(keyword) {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(
      keyword
    )}&limit=3`;
    const res = await axios.get(url);
    const posts = res.data.data.children.map((post) => ({
      title: post.data.title,
      url: `https://reddit.com${post.data.permalink}`,
      score: post.data.score,
    }));
    return posts;
  } catch (e) {
    console.error(`Reddit error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromDuckDuckGo(keyword) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      keyword
    )}&format=json&no_redirect=1`;
    const res = await axios.get(url);
    return {
      Heading: res.data.Heading,
      AbstractText: res.data.AbstractText,
      AbstractURL: res.data.AbstractURL,
      RelatedTopics: res.data.RelatedTopics?.slice(0, 3) || [],
    };
  } catch (e) {
    console.error(`DuckDuckGo error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromHN(keyword) {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      keyword
    )}&hitsPerPage=3`;
    const res = await axios.get(url);
    const hits = res.data.hits.map((hit) => ({
      title: hit.title,
      url: hit.url,
      points: hit.points,
      author: hit.author,
    }));
    return hits;
  } catch (e) {
    console.error(`HN Search error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromPublicAPIs(keyword) {
  try {
    const url = `https://api.publicapis.org/entries?title=${encodeURIComponent(
      keyword
    )}`;
    const res = await axios.get(url);
    return res.data.entries?.slice(0, 3) || [];
  } catch (e) {
    console.error(`Public APIs error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromOpenLibrary(keyword) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
      keyword
    )}&limit=3`;
    const res = await axios.get(url);
    const docs = res.data.docs.map((doc) => ({
      title: doc.title,
      author_name: doc.author_name,
      first_publish_year: doc.first_publish_year,
    }));
    return docs;
  } catch (e) {
    console.error(`OpenLibrary error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromCoinDesk(keyword) {
  try {
    const url = `https://api.coindesk.com/v1/bpi/currentprice.json`;
    const res = await axios.get(url);
    return {
      time: res.data.time.updated,
      USD: res.data.bpi.USD.rate,
      GBP: res.data.bpi.GBP.rate,
      EUR: res.data.bpi.EUR.rate,
    };
  } catch (e) {
    console.error(`CoinDesk error for "${keyword}":`, e.message);
    return null;
  }
}

async function fetchFromTVMaze(keyword) {
  try {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(
      keyword
    )}`;
    const res = await axios.get(url);
    return res.data.slice(0, 3).map((item) => ({
      name: item.show.name,
      url: item.show.officialSite || item.show.url,
      summary: item.show.summary,
      genres: item.show.genres,
      rating: item.show.rating.average,
    }));
  } catch (e) {
    console.error(`TVMaze error for "${keyword}":`, e.message);
    return null;
  }
}

const apiFetchers = [
  { name: "wikipedia", fn: fetchFromWikipedia },
  { name: "reddit", fn: fetchFromReddit },
  { name: "duckduckgo", fn: fetchFromDuckDuckGo },
  { name: "hackernews", fn: fetchFromHN },
  { name: "publicapis", fn: fetchFromPublicAPIs },
  { name: "openlibrary", fn: fetchFromOpenLibrary },
  { name: "coindesk", fn: fetchFromCoinDesk },
  { name: "tvmaze", fn: fetchFromTVMaze },
];

// Main execution
async function main() {
  const keywords = await readKeywords();
  if (!keywords.length) {
    console.log("No keywords to process.");
    return;
  }

  for (const keyword of keywords) {
    console.log(`\n🕵️‍♂️ Processing "${keyword}"`);

    const results = [];
    const triedApis = new Set();

    // Helper to try an API and add result if data found
    async function tryApi(api) {
      if (triedApis.has(api.name)) return false;
      triedApis.add(api.name);
      console.log(`Fetching from ${api.name}...`);
      const data = await api.fn(keyword);
      if (hasMeaningfulData(data)) {
        await saveResult(keyword, api.name, data);
        console.log(`Saved ${api.name} data for "${keyword}"`);
        results.push(api.name);
        return true;
      } else {
        console.log(`No meaningful data from ${api.name} for "${keyword}"`);
        return false;
      }
    }

    // Try first two APIs in order
    const firstTwoApis = apiFetchers.slice(0, 2);
    for (let i = 0; i < firstTwoApis.length; i++) {
      const success = await tryApi(firstTwoApis[i]);
      if (!success) {
        // If fails, try next API in list not tried yet
        for (const api of apiFetchers) {
          if (!triedApis.has(api.name)) {
            const retrySuccess = await tryApi(api);
            if (retrySuccess) break;
          }
        }
      }
      if (results.length >= 2) break; // stop if we have two API results
      await delay(1500);
    }

    // If after this we still have less than 2 results, try remaining APIs in order
    if (results.length < 2) {
      for (const api of apiFetchers) {
        if (!triedApis.has(api.name)) {
          const success = await tryApi(api);
          if (success) {
            if (results.length >= 2) break;
          }
          await delay(1500);
        }
      }
    }

    if (results.length === 0) {
      console.log(
        `❌ No meaningful data found for keyword "${keyword}" from any API.`
      );
    }
  }

  console.log("\n✅ All keywords processed.");
}

main().catch(console.error);
