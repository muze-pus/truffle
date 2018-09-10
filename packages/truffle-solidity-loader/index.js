const path = require('path')
const fs = require('fs')
const { getOptions } = require('loader-utils')
const validateOptions = require('schema-utils')
const truffleMigrator = require('truffle-core/lib/commands/migrate')

const Logger = require('./lib/logDecorator')
const genBuildOptions = require('./lib/genBuildOptions')

function parseContractName (resourcePath) {
  var contractFileName = path.basename(resourcePath)
  return contractFileName.charAt(0).toUpperCase() + contractFileName.slice(1, contractFileName.length - 4)
}

function returnContractAsSource (filePath, callback) {
  return fs.readFile(filePath, 'utf8', function (err, solJSON) {
    if (err) {
      Logger.error(err)
      return callback(err, null)
    }
    callback(null, solJSON)
  })
}

function compiledContractExists (filePath) {
  try {
    fs.statSync(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return false
  }
  return true
}

const schema = {
  'type': 'object',
  'required': ['network'],
  'properties': {
    'migrations_directory': {
      'type': 'string'
    },
    'network': {
      'type': 'string'
    },
    'contracts_build_directory': {
      'type': 'string'
    }
  },
  'additionalProperties': false
}

var isCompilingContracts = false // Global mutex variable
module.exports = function (source, map, meta) {
  let WebpackOptions = getOptions(this) || {}
  validateOptions(schema, WebpackOptions, 'truffle-solidity-loader')

  let buildOpts = genBuildOptions(WebpackOptions)
  let migrationsDirectory = WebpackOptions.migrations_directory || `${buildOpts.working_directory}/migrations`
  let contractsBuildDirectory = WebpackOptions.contracts_build_directory || `${buildOpts.working_directory}/build/contracts`
  let contractName = parseContractName(this.resourcePath) // this.resourcePath will be the path to the .sol file
  let contractJsonPath = path.resolve(buildOpts.contracts_build_directory, contractName + '.json')

  this.addDependency(this.resource)

  if (this.debug) {
    Logger.debugger(`this.resourcePath = ${this.resourcePath}`)
    Logger.debugger(`contract Name = ${contractName}`)
    Logger.debugger(`migrations Directory = ${migrationsDirectory}`)
    Logger.debugger(`contracts Build Directory = ${contractsBuildDirectory}`)
    Logger.debugger(`contract Json Path = ${contractJsonPath}`)
  }

  let callback = this.async()

  function waitForContractCompilation () {
    setTimeout(function () {
      if (compiledContractExists(contractJsonPath)) {
        isCompilingContracts = false
        returnContractAsSource(contractJsonPath, callback)
      } else {
        waitForContractCompilation()
      }
    }, 500)
  }

  if (isCompilingContracts) {
    // Logger.debugger(`Currently compiling = ${this.resourcePath}`)
    waitForContractCompilation()
  } else {
    isCompilingContracts = true
    truffleMigrator.run(buildOpts, function (err) {
      isCompilingContracts = false
      if (err) {
        return callback(err)
      } else {
        return returnContractAsSource(contractJsonPath, callback)
      }
    })
  }
}
