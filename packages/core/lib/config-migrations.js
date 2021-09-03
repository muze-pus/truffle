const OS = require("os");
const path = require("path");
const fse = require("fs-extra");
const Conf = require("conf");
const { promisify } = require("util");
const copy = require("./copy");

module.exports = {
  oldTruffleFolder: path.join(OS.homedir(), ".config", "truffle"),

  needsMigrated: function () {
    const oldConfig = path.join(this.oldTruffleFolder, "config.json");
    const conf = new Conf({ projectName: "truffle" });
    return fse.existsSync(oldConfig) && oldConfig !== conf.path;
  },

  migrateTruffleDataIfNecessary: async function () {
    if (!this.needsMigrated) return;
    this.migrateGlobalConfig();
    const folders = ["compilers", ".db"];
    for (const folder of folders) {
      await this.migrateFolder(folder);
    }
  },

  migrateGlobalConfig: function () {
    const conf = new Conf({ projectName: "truffle" });
    const oldSettings = require(path.join(
      this.oldTruffleFolder,
      "config.json"
    ));
    for (const key in oldSettings) {
      conf.set(key, oldSettings[key]);
    }
  },

  migrateFolder: async function (folderName) {
    const targetPath = path.join(this.oldTruffleFolder, folderName);
    // use conf to determine the new Truffle folder as it uses OS-appropriate locations
    const conf = new Conf({ projectName: "truffle" });
    const destinationPath = path.join(path.dirname(conf.path), folderName);
    if (fse.existsSync(targetPath)) {
      await promisify(copy)(targetPath, destinationPath, {});
    }
  }
};
