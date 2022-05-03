function resolveNetworkId(network_id) {
  // Use default network_id if "*" is defined in config
  if (network_id === "*") {
    return Date.now();
  }

  const parsedNetworkId = parseInt(network_id, 10);
  if (isNaN(parsedNetworkId)) {
    const error =
      `The network id specified in the truffle config ` +
      `(${network_id}) is not valid. Please properly configure the network id as an integer value.`;
    throw new Error(error);
  }

  return parsedNetworkId;
}

// This function returns the first defined argument value
const getFirstDefinedValue = (...values) =>
  values.find(value => value !== undefined);

function configureManagedGanache(config, networkConfig, mnemonic) {
  const host = getFirstDefinedValue(
    networkConfig.host,
    "127.0.0.1" // Use as default host
  );

  const port = getFirstDefinedValue(
    networkConfig.port,
    9545 // Use as default port
  );

  const network_id = getFirstDefinedValue(
    networkConfig.network_id,
    5777 // Use as default network_id
  );

  const total_accounts = getFirstDefinedValue(
    networkConfig.accounts,
    networkConfig.total_accounts,
    10 // Use as default number of accounts
  );

  const default_balance_ether = getFirstDefinedValue(
    networkConfig.defaultEtherBalance,
    networkConfig.default_balance_ether,
    100 // Use as default ether balance for each account
  );

  const blockTime = getFirstDefinedValue(networkConfig.blockTime);

  const fork = getFirstDefinedValue(networkConfig.fork);

  const hardfork = getFirstDefinedValue(networkConfig.hardfork);

  const gasLimit = getFirstDefinedValue(networkConfig.gasLimit);

  const gasPrice = getFirstDefinedValue(networkConfig.gasPrice);

  const genesisTime = getFirstDefinedValue(
    config.time,
    config.genesis_time,
    networkConfig.time,
    networkConfig.genesis_time
  );

  const ganacheOptions = {
    host,
    port,
    network_id,
    total_accounts,
    default_balance_ether,
    blockTime,
    fork,
    hardfork,
    mnemonic,
    gasLimit,
    gasPrice,
    time: genesisTime,
    miner: {
      instamine: "strict"
    }
  };

  ganacheOptions.network_id = resolveNetworkId(network_id);
  return ganacheOptions;
}

module.exports = { configureManagedGanache, getFirstDefinedValue };
