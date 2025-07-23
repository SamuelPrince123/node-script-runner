import admin from "firebase-admin";
import fs from "fs/promises";

const serviceAccount = JSON.parse(
  await fs.readFile("serviceAccountKey.json", "utf-8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://language-fire-default-rtdb.firebaseio.com",
});

const db = admin.database();

async function generateKeywordResultsHtml() {
  const snapshot = await db.ref("results").once("value");
  const results = snapshot.val();

  if (!results) return "<p>No keyword results found.</p>";

  let html = "";

  for (const keywordKey in results) {
    const keywordDisplay = keywordKey.replace(/_/g, " ");

    html += `<article class="keyword-block">\n`;
    html += `<h3> ${keywordDisplay}</h3>\n`;

    const apis = results[keywordKey];
    for (const apiName in apis) {
      html += `<section class="api-result">\n`;
      html += `<h4>${
        apiName.charAt(0).toUpperCase() + apiName.slice(1)
      }</h4>\n`;

      const data = apis[apiName];

      if (Array.isArray(data)) {
        html += "<ul>\n";
        for (const item of data) {
          if (item.title && item.url) {
            html += `<li><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></li>\n`;
          } else if (typeof item === "string") {
            html += `<li>${item}</li>\n`;
          } else {
            html += `<li>${JSON.stringify(item)}</li>\n`;
          }
        }
        html += "</ul>\n";
      } else if (typeof data === "object") {
        if (data.title && data.extract) {
          html += `<p><strong>Title:</strong> ${data.title}</p>\n`;
          html += `<p>${data.extract}</p>\n`;
          if (data.url)
            html += `<p><a href="${data.url}" target="_blank" rel="noopener">Read more</a></p>\n`;
        } else {
          html += `<pre>${JSON.stringify(data, null, 2)}</pre>\n`;
        }
      } else {
        html += `<p>${data}</p>\n`;
      }

      html += `</section>\n`;
    }

    html += `</article>\n`;
  }

  return html;
}

async function main() {
  const htmlContent = await generateKeywordResultsHtml();

  // Save to local file
  await fs.writeFile("keywordresult.html", htmlContent, "utf-8");

  console.log("✅ keywordresult.html generated successfully.");
}

main().catch(console.error);
