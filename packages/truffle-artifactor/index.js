var Schema = require("truffle-contract-schema");
var fs = require("fs-extra");
var path = require("path");
var _ = require("lodash");
var debug = require("debug")("artifactor");

class Artifactor {
  constructor(destination) {
    this.destination = destination;
  }

  async save(artifactObject) {
    const self = this;

    const normalizedArtifact = Schema.normalize(artifactObject);
    const contractName = normalizedArtifact.contractName;

    if (!contractName) throw new Error("You must specify a contract name.");

    const output_path = path.join(self.destination, `${contractName}.json`);
    let completeArtifact = {};

    // helper for writing artifacts
    const writeArtifact = _completeArtifact => {
      _completeArtifact.updatedAt = new Date().toISOString();
      fs.writeFileSync(
        output_path,
        JSON.stringify(_completeArtifact, null, 2),
        "utf8"
      );
    };

    try {
      const existingArtifact = fs.readFileSync(output_path, "utf8"); // check if artifact already exists
      const existingArtifactObject = JSON.parse(existingArtifact); // parse existing artifact
      const normalizedExistingArtifact = Schema.normalize(
        existingArtifactObject
      );
      _.merge(completeArtifact, normalizedExistingArtifact, normalizedArtifact);
      writeArtifact(completeArtifact);
    } catch (e) {
      // if artifact doesn't already exist, write new file
      if (e.code === "ENOENT") return writeArtifact(normalizedArtifact);
      else if (e instanceof SyntaxError) throw new Error(e); // catches improperly formatted artifact json
      throw new Error(e); // catch all other errors
    }
  }

  async saveAll(artifactObjects) {
    const self = this;
    let newArtifactObjects = {};

    if (Array.isArray(artifactObjects)) {
      const tmpArtifactArray = artifactObjects;

      tmpArtifactArray.forEach(artifactObj => {
        newArtifactObjects[artifactObj.contract_name] = artifactObj;
      });
    } else {
      newArtifactObjects = artifactObjects;
    }

    try {
      fs.statSync(self.destination); // check if destinationn exists
    } catch (e) {
      if (e.code === "ENOENT")
        // if destination doesn't exist, throw error
        throw new Error(`Destination "${self.destination}" doesn't exist!`);
      throw new Error(e); // throw on all other errors
    }

    Object.keys(newArtifactObjects).forEach(contractName => {
      let artifactObject = newArtifactObjects[contractName];
      self.save(artifactObject);
    });
  }
}

module.exports = Artifactor;
