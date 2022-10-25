const MemoryLogger = require("../MemoryLogger");
const CommandRunner = require("../commandRunner");
const path = require("path");
const assert = require("assert");
const Server = require("../server");
const sandbox = require("../sandbox");

describe("migrate (dry-run)", function () {
  let config, cleanupSandboxDir;
  const project = path.join(__dirname, "../../sources/migrations/success");
  const logger = new MemoryLogger();

  before(async function () {
    this.timeout(10000);
    await Server.start();
    ({ config, cleanupSandboxDir } = await sandbox.create(project));
    config.network = "development";
    config.logger = logger;
  });
  after(async function () {
    await Server.stop();
    cleanupSandboxDir();
  });

  it("uses the dry-run option", async function () {
    this.timeout(120000);
    await CommandRunner.run("migrate --dry-run", config);
    const output = logger.contents();
    console.log(output);
    assert(output.includes("dry-run"));
    assert(!output.includes("transaction hash"));
    assert(output.includes("Migrations"));
    assert(output.includes("development-fork"));
    assert(output.includes("2_migrations_sync.js"));
    assert(output.includes("Deploying 'UsesExample'"));
    assert(output.includes("3_migrations_async.js"));
    assert(output.includes("Replacing 'UsesExample'"));
    assert(output.includes("Total deployments"));
  });
});
