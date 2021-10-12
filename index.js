const fs = require("fs").promises;
const config = require("@commitlint/config-conventional");
const core = require("@actions/core");
const github = require("@actions/github");
const lint = require("@commitlint/lint").default;
const format = require("@commitlint/format").default;

const HEADER = `#pr-title-conventional-checker-action \r\n \r\n`;
const defaultConfigRules = config.rules;
const defaultOpts = {
  headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
  headerCorrespondence: ["type", "scope", "subject"],
  noteKeywords: ["BREAKING CHANGE"],
  revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
  revertCorrespondence: ["header", "hash"],
  issuePrefixes: ["#"],
};

async function validatePRMessage(msg, rules, opts) {
  return lint(msg, rules, opts);
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

function displayStatus(isValid) {
  return `${isValid ? "valid" : "incorrect"} ${
    isValid
      ? "![#c5f015](https://via.placeholder.com/15/c5f015/000000?text=+)"
      : "![#f03c15](https://via.placeholder.com/15/f03c15/000000?text=+)"
  }`;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function getConfigRules(filePath) {
  const json = await readJsonFile(filePath);
  return json.rules;
}

async function main(msg, token, configFilePath, optsFilePath) {
  // get the config files if it is defined, otherwise use defaults (conventional)
  const config = !!configFilePath ? await getConfigRules(configFilePath) : defaultConfigRules;
  const opts = !!optsFilePath ? await readJsonFile(optsFilePath) : defaultOpts;

  // validate the PR Message and format - output it in console
  const res = await validatePRMessage(msg, config, opts);
  const report = format({ results: [res] }, { color: false });

  let out = `${HEADER}
  The Pull request title \`${msg}\` is **${displayStatus(res.valid)}**.  `;

  if (!res.valid) {
    out += `\r\n\r\n Here was the failure report:  

\`\`\`
${report}
\`\`\`

Please correct your pull request title to pass. This ensures this work will be correctly noted in the changelog.  
Need help? Read https://www.conventionalcommits.org/en/v1.0.0/#summary.  
    `;
  }

  console.log(out);

  // if token was supplied, create PR comment
  if (token) {
    await createPRComment(out, token);
  }

  // if invalid then set Failed message to why
  if (!res.valid) {
    core.setFailed(out);
  }
}

main(
  github.context.payload.pull_request.title,
  core.getInput("github-token"),
  core.getInput("config-file"),
  core.getInput("opts-file")
);
