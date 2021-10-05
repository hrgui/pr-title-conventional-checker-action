const core = require("@actions/core");
const github = require("@actions/github");
const load = require("@commitlint/load").default;
const lint = require("@commitlint/lint").default;
const format = require("@commitlint/format").default;

const CONFIG = {
  extends: ["@commitlint/config-conventional"],
};

const HEADER = `#pr-title-conventional-checker-action \r\n \r\n`;

async function validatePRMessage(msg) {
  const opts = await load(CONFIG);
  const res = await lint(
    msg,
    opts.rules,
    opts.parserPreset ? { parserOpts: opts.parserPreset.parserOpts } : {}
  );

  return res;
}

async function deletePreviousComments(ghClient, whatToLookFor) {
  const context = github.context;
  const { data } = await ghClient.issues.listComments({
    ...context.repo,
    per_page: 100,
    issue_number: context.payload.pull_request.number,
  });
  return Promise.all(
    data
      .filter((c) => c.user.login === "github-actions[bot]" && c.body.startsWith(whatToLookFor))
      .map((c) => ghClient.issues.deleteComment({ ...context.repo, comment_id: c.id }))
  );
}

async function createPRComment(body, token) {
  const context = github.context;
  const ghClient = new github.GitHub(token);

  await deletePreviousComments(ghClient, HEADER);

  await ghClient.issues.createComment({
    repo: context.repo.repo,
    owner: context.repo.owner,
    issue_number: context.payload.pull_request.number,
    body,
  });
}

async function main(msg, token) {
  const res = await validatePRMessage(msg);
  const report = format({ results: [res] }, { color: false });

  let out = `${HEADER}
  The Pull request title ${msg} is **${res.valid ? "valid" : "incorrect"}**.`;

  if (!res.valid) {
    out += `
      Here was the failure report:  

      \`\`\`
      ${report}
      \`\`\`
      
      Please correct your pull request title to pass. This ensures this work will be correctly noted in the changelog.  
      Need help? Read https://www.conventionalcommits.org/en/v1.0.0/#summary.  
    `;
  }

  console.log(out);

  if (token) {
    await createPRComment(out, token);
  }

  core.setFailed(!res.valid);
}

main(github.context.payload.pull_request.title, core.getInput("github-token"));
