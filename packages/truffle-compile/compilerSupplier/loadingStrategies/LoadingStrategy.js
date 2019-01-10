const requireFromString = require("require-from-string");
const solcWrap = require("solc/wrapper");
const { execSync } = require("child_process");
const findCacheDir = require("find-cache-dir");
const ora = require("ora");
const request = require("request-promise");
const fs = require("fs");
const semver = require("semver");

class LoadingStrategy {
  constructor(options) {
    const defaultConfig = {
      versionsUrl: "https://solc-bin.ethereum.org/bin/list.json",
      compilerUrlRoot: "https://solc-bin.ethereum.org/bin/",
      dockerTagsUrl:
        "https://registry.hub.docker.com/v2/repositories/ethereum/solc/tags/",
      cache: true
    };
    this.config = Object.assign({}, defaultConfig, options);
    this.cachePath = findCacheDir({
      name: "truffle",
      cwd: __dirname,
      create: true
    });
  }

  /**
   * Write  to the cache at `config.cachePath`. Creates `cachePath` directory if
   * does not exist.
   * @param {String} code       JS code string downloaded from solc-bin
   * @param {String} fileName   ex: "soljson-v0.4.21+commit.dfe3193c.js"
   */
  addToCache(code, fileName) {
    if (!this.config.cache) return;

    const filePath = this.resolveCache(fileName);
    fs.writeFileSync(filePath, code);
  }

  findNewestValidVersion(version, allVersions) {
    if (!semver.validRange(version)) return null;
    const satisfyingVersions = Object.keys(allVersions.releases)
      .map(solcVersion => {
        if (semver.satisfies(solcVersion, version)) return solcVersion;
      })
      .filter(solcVersion => solcVersion);
    if (satisfyingVersions.length > 0) {
      return satisfyingVersions.reduce((newestVersion, version) => {
        return semver.gtr(version, newestVersion) ? version : newestVersion;
      }, "0.0.0");
    } else {
      return null;
    }
  }

  /**
   * Makes solc.compile a wrapper to a child process invocation of dockerized solc
   * or natively build solc. Also fetches a companion solcjs for the built js to parse imports
   * @return {Object} solc output
   */
  getBuilt(buildType) {
    let versionString, command;

    switch (buildType) {
      case "native":
        versionString = this.validateNative();
        command = "solc --standard-json";
        break;
      case "docker":
        versionString = this.validateDocker();
        command =
          "docker run -i ethereum/solc:" +
          this.config.version +
          " --standard-json";
        break;
    }

    const commit = this.getCommitFromVersion(versionString);

    return this.getSolcForNativeOrDockerCompile(commit).then(solcjs => {
      return {
        compile: options => String(execSync(command, { input: options })),
        version: () => versionString,
        importsParser: solcjs
      };
    });
  }

  getCachedSolcFileName(commitString) {
    const cachedCompilerFileNames = fs.readdirSync(this.cachePath);
    return cachedCompilerFileNames.find(fileName => {
      return fileName.includes(commitString);
    });
  }

  /**
   * Extracts a commit key from the version info returned by native/docker solc.
   * We use this to fetch a companion solcjs from solc-bin in order to parse imports
   * correctly.
   * @param  {String} versionString   version info from ex: `solc -v`
   * @return {String}                 commit key, ex: commit.4cb486ee
   */
  getCommitFromVersion(versionString) {
    return "commit." + versionString.match(/commit\.(.*?)\./)[1];
  }

  async getSolcForNativeOrDockerCompile(commitString) {
    const solcFileName = this.getCachedSolcFileName(commitString);
    if (solcFileName) return this.getFromCache(solcFileName);

    const allVersions = await this.getSolcVersions(this.config.versionsUrl);
    const fileName = this.getVersionUrlSegment(commitString, allVersions);

    if (!fileName) throw this.errors("noVersion", version);

    const url = this.config.compilerUrlRoot + fileName;
    const spinner = ora({
      text: "Downloading compiler",
      color: "red"
    }).start();

    return this.getSolcByUrlAndCache(url, fileName, spinner);
  }

  async getSolcByUrlAndCache(url, fileName, spinner) {
    try {
      const response = await request.get(url);
      if (spinner) spinner.stop();
      this.addToCache(response, fileName);
      return this.compilerFromString(response);
    } catch (error) {
      if (spinner) spinner.stop();
      throw this.errors("noRequest", url, error);
    }
  }

  getSolcVersions() {
    const spinner = ora({
      text: "Fetching solc version list from solc-bin",
      color: "yellow"
    }).start();

    return request(this.config.versionsUrl)
      .then(list => {
        spinner.stop();
        return JSON.parse(list);
      })
      .catch(err => {
        spinner.stop();
        throw self.errors("noRequest", this.config.versionsUrl, err);
      });
  }

  /**
   * Returns terminal url segment for `version` from the versions object
   * generated  by `getSolcVersions`.
   * @param  {String} version         ex: "0.4.1", "0.4.16-nightly.2017.8.9+commit.81887bc7"
   * @param  {Object} allVersions     (see `getSolcVersions`)
   * @return {String} url             ex: "soljson-v0.4.21+commit.dfe3193c.js"
   */
  getVersionUrlSegment(version, allVersions) {
    if (allVersions.releases[version]) return allVersions.releases[version];

    const isPrerelease =
      version.includes("nightly") || version.includes("commit");

    if (isPrerelease) {
      for (let build of allVersions.builds) {
        const exists =
          build["prerelease"] === version ||
          build["build"] === version ||
          build["longVersion"] === version;

        if (exists) return build["path"];
      }
    }

    const versionToUse = this.findNewestValidVersion(version, allVersions);
    if (versionToUse) return allVersions.releases[versionToUse];

    return null;
  }

  /**
   * Returns true if `fileName` exists in the cache.
   * @param  {String}  fileName   ex: "soljson-v0.4.21+commit.dfe3193c.js"
   * @return {Boolean}
   */
  fileIsCached(fileName) {
    const file = this.resolveCache(fileName);
    return fs.existsSync(file);
  }

  compilerFromString(code) {
    const soljson = requireFromString(code);
    const wrapped = solcWrap(soljson);
    this.removeListener();
    return wrapped;
  }

  /**
   * Converts shell exec'd solc version from buffer to string and strips out human readable
   * description.
   * @param  {Buffer} version result of childprocess
   * @return {String}         normalized version string: e.g 0.4.22+commit.4cb486ee.Linux.g++
   */
  normalizeVersion(version) {
    version = String(version);
    return version.split(":")[1].trim();
  }

  /**
   * Cleans up error listeners set (by solc?) when requiring it. (This code inherited from
   * previous implementation, note to self - ask Tim about this)
   */
  removeListener() {
    const listeners = process.listeners("uncaughtException");
    const execeptionHandler = listeners[listeners.length - 1];

    if (execeptionHandler) {
      process.removeListener("uncaughtException", execeptionHandler);
    }
  }

  /**
   * Returns path to cached solc version
   * @param  {String} fileName ex: "soljson-v0.4.21+commit.dfe3193c.js"
   * @return {String}          path
   */
  resolveCache(fileName) {
    const thunk = findCacheDir({
      name: "truffle",
      cwd: __dirname,
      thunk: true
    });
    return thunk(fileName);
  }

  validateNative() {
    let version;
    try {
      version = execSync("solc --version");
    } catch (err) {
      throw this.errors("noNative", null, err);
    }

    return this.normalizeVersion(version);
  }

  /**
   * Checks to make sure image is specified in the config, that docker exists and that
   * the image exists locally. If the last condition isn't true, docker will try to pull
   * it down and this breaks everything.
   * @return {String}  solc version string
   * @throws {Error}
   */
  validateDocker() {
    const image = this.config.version;
    const fileName = image + ".version";

    // Skip validation if they've validated for this image before.
    if (this.fileIsCached(fileName)) {
      const cachePath = this.resolveCache(fileName);
      return fs.readFileSync(cachePath, "utf-8");
    }

    // Image specified
    if (!image) throw this.errors("noString", image);

    // Docker exists locally
    try {
      execSync("docker -v");
    } catch (err) {
      throw this.errors("noDocker");
    }

    // Image exists locally
    try {
      execSync("docker inspect --type=image ethereum/solc:" + image);
    } catch (err) {
      throw this.errors("noImage", image);
    }

    // Get version & cache.
    const version = execSync(
      "docker run ethereum/solc:" + image + " --version"
    );
    const normalized = this.normalizeVersion(version);
    this.addToCache(normalized, fileName);
    return normalized;
  }

  errors(kind, input, error) {
    const info = "Run `truffle compile --list` to see available versions.";

    const kinds = {
      noPath: "Could not find compiler at: " + input,
      noVersion:
        `Could not find a compiler version matching ${input}. ` +
        `Please ensure you are specifying a valid version, constraint or ` +
        `build in the truffle config. ${info}`,
      noRequest:
        "Failed to complete request to: " +
        input +
        ". Are you connected to the internet?\n\n" +
        error,
      noDocker:
        "You are trying to run dockerized solc, but docker is not installed.",
      noImage:
        "Please pull " +
        input +
        " from docker before trying to compile with it.",
      noNative: "Could not execute local solc binary: " + error,
      noString:
        "`compilers.solc.version` option must be a string specifying:\n" +
        "   - a path to a locally installed solcjs\n" +
        "   - a solc version or range (ex: '0.4.22' or '^0.5.0')\n" +
        "   - a docker image name (ex: 'stable')\n" +
        "   - 'native' to use natively installed solc\n" +
        "Received: " +
        input +
        " instead."
    };

    return new Error(kinds[kind]);
  }
}

module.exports = LoadingStrategy;
