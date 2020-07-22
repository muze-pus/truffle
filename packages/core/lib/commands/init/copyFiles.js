const path = require("path");
const fse = require("fs-extra");
const { promptOverwrites } = require("./promptOverwrites");

const copyFiles = async (destination, options) => {
  fse.ensureDirSync(destination);
  const { force, logger, events } = options;
  const sourcePath = path.join(__dirname, "initSource");
  const projectFiles = fse.readdirSync(sourcePath);
  const destinationContents = fse.readdirSync(destination);

  const newContents = projectFiles.filter(
    (filename) => !destinationContents.includes(filename)
  );

  const contentCollisions = projectFiles.filter((filename) =>
    destinationContents.includes(filename)
  );

  let shouldCopy;
  if (force) {
    shouldCopy = boxContents;
  } else {
    const overwriteContents = await promptOverwrites(contentCollisions, logger);
    shouldCopy = [...newContents, ...overwriteContents];
  }

  await events.emit("init:copyingProjectFiles", {
    destinationPath: destination,
  });
  for (const file of shouldCopy) {
    fse.copySync(sourcePath, path.join(destination, file));
  }
};

module.exports = { copyFiles };
