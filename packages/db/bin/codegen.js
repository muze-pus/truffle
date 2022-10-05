const fse = require("fs-extra");
const path = require("path");
const { generateNamespace: generate } = require("@gql2ts/from-schema");
const { camelCase, pascalCase } = require("change-case");
const { plural } = require("pluralize");
const { printSchema } = require("graphql");

const {
  Graph: { schema },
  Resources: { definitions }
} = require("@truffle/db");

const generateNamespace = (namespaceName, interfaces) => `// tslint-disable
// graphql typescript definitions

/**
 * @category Primary
 */
declare namespace ${namespaceName} {
${interfaces}
}

// tslint:enable
`;

const interfaceBuilder = (name, body) => {
  const isRoot = name => name === "Query" || name === "Mutation";
  const isResource = name => camelCase(plural(name)) in definitions;
  const isInput = name =>
    name.endsWith("Input") && isResource(name.slice(0, -5));

  if (isRoot(name)) {
    return `/**
 * @category Schema Root
 */
interface ${name} ${body}`;
  }

  if (isResource(name)) {
    return `/**
 * @category Resource
 */
interface ${name} ${body}`;
  }

  if (isInput(name)) {
    return `/**
 * @category Resource Input
 */
interface ${name} ${body}`;
  }

  return `interface ${name} ${body}`;
};

const generateInterfaceName = name => pascalCase(name);

const dataModel = generate(
  "_DataModel",
  schema,
  {
    ignoreTypeNameDeclaration: true,
    ignoredTypes: ["Resource", "Named", "Entry"]
  },
  {
    interfaceBuilder,
    generateInterfaceName,
    generateNamespace
  }
);

fse.writeFileSync(
  path.join(__dirname, "..", "types", "schema.d.ts"),
  dataModel
);

fse.ensureDirSync(path.join(__dirname, "..", "dist"));

fse.writeFileSync(
  path.join(__dirname, "..", "dist", "schema.sdl"),
  printSchema(schema)
);
