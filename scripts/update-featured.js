// Rewrites the Featured Projects block in README.md with the two most
// recently active public, non-fork repos that have >= MIN_COMMITS commits.
// Run by .github/workflows/update-featured.yml on a schedule and on push.

const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GITHUB_USERNAME || "MuhammadAbbas010";
const TOKEN = process.env.GITHUB_TOKEN;
const MIN_COMMITS = 10;
const README_PATH = path.join(__dirname, "..", "README.md");
const START_MARKER = "<!-- FEATURED:START -->";
const END_MARKER = "<!-- FEATURED:END -->";
const SELF_REPO = USERNAME.toLowerCase();

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${USERNAME}-featured-projects-bot`,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function githubJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// GitHub returns commit count implicitly via pagination: with per_page=1,
// the "last" page number in the Link header equals the total commit count
// on the repo's default branch.
async function getCommitCount(repoFullName) {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/commits?per_page=1`,
    { headers }
  );
  if (!res.ok) {
    // Empty repos (0 commits) return 409; treat as zero.
    if (res.status === 409) return 0;
    throw new Error(
      `GET commits for ${repoFullName} failed: ${res.status} ${res.statusText}`
    );
  }
  const link = res.headers.get("link");
  if (!link) {
    const body = await res.json();
    return Array.isArray(body) ? body.length : 0;
  }
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : 1;
}

async function pickFeaturedRepos() {
  const repos = await githubJson(
    `https://api.github.com/users/${USERNAME}/repos?type=owner&per_page=100&sort=pushed`
  );

  const candidates = repos.filter(
    (r) =>
      !r.fork &&
      !r.archived &&
      !r.private &&
      r.name.toLowerCase() !== SELF_REPO
  );

  const withCommitCounts = [];
  for (const repo of candidates) {
    const commits = await getCommitCount(repo.full_name);
    if (commits >= MIN_COMMITS) {
      withCommitCounts.push({ repo, commits });
    }
  }

  withCommitCounts.sort(
    (a, b) => new Date(b.repo.pushed_at) - new Date(a.repo.pushed_at)
  );

  return withCommitCounts.slice(0, 2).map((entry) => entry.repo.name);
}

function renderCard(repoName) {
  if (!repoName) {
    return `  <span style="display:inline-block;width:49%;">Coming soon...</span>`;
  }
  return `  <a href="https://github.com/${USERNAME}/${repoName}">
    <img
      width="49%"
      src="https://github-readme-stats.vercel.app/api/pin/?username=${USERNAME}&repo=${repoName}&theme=algolia"
    />
  </a>`;
}

function renderBlock(repoNames) {
  const [first, second] = repoNames;
  return `${START_MARKER}
<p align="center">
${renderCard(first)}

${renderCard(second)}
</p>
${END_MARKER}`;
}

async function main() {
  const featured = await pickFeaturedRepos();
  const block = renderBlock(featured);

  const readme = fs.readFileSync(README_PATH, "utf8");
  const pattern = new RegExp(
    `${START_MARKER}[\\s\\S]*?${END_MARKER}`
  );

  if (!pattern.test(readme)) {
    throw new Error(
      `Could not find ${START_MARKER} / ${END_MARKER} markers in README.md`
    );
  }

  const updated = readme.replace(pattern, block);
  fs.writeFileSync(README_PATH, updated);

  console.log(
    featured.length
      ? `Featured: ${featured.join(", ")}`
      : `No repo currently has >= ${MIN_COMMITS} commits; left placeholders.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
