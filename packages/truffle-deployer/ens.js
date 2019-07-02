const ENSJS = require("ethereum-ens");

class ENS {
  constructor({ provider, resolver }) {
    this.provider = provider;
    this.resolver = resolver;
  }

  async deployNewENSRegistry(from) {
    const ENSRegistry = this.resolver.require("@ensdomains/ens/ENSRegistry");
    ENSRegistry.setProvider(this.provider);
    const ensRegistry = await ENSRegistry.new({ from });
    return ensRegistry;
  }

  async register({ address, name, from, registryAddress }) {
    this.currentRegistryAddress = registryAddress;
    let ensjs = new ENSJS(this.provider, registryAddress);
    let registry;
    try {
      // See if registry exists on network by resolving an arbitrary address
      await ensjs.owner("0x0");
    } catch (error) {
      // If no registry, deploy one
      const noRegistryFound =
        error.message ===
        "This contract object doesn't have address set yet, please set an address first.";
      if (noRegistryFound) {
        registry = await this.deployNewENSRegistry(from);
        this.currentRegistryAddress = registry.address;
        ensjs = new ENSJS(this.provider, this.currentRegistryAddress);
      } else {
        throw error;
      }
    }

    // Find the owner of the name and compare it to the "from" field
    const nameOwner = await ensjs.owner(name);
    // Future work:
    // Handle case where there is no owner and we try to register it for the user
    // if (nameOwner === "0x0000000000000000000000000000000000000000") {
    //   this.attemptNameRegistration();
    // }

    if (nameOwner !== from) {
      const message =
        `The default address or address provided in the "from" ` +
        `field for registering does not own the specified ENS name. The ` +
        `"from" field address must match the owner of the name.` +
        `\n> Failed to register ENS name ${name}` +
        `\n> Address in "from" field - ${from}` +
        `\n> Current owner of '${name}' - ${nameOwner}`;
      throw new Error(message);
    }

    // See if the resolver is set, if not then set it
    let resolvedAddress, publicResolver;
    try {
      resolvedAddress = await ensjs.resolver(name).addr();
    } catch (error) {
      if (error.message !== "ENS name not found") throw error;
      const PublicResolver = this.resolver.require(
        "@ensdomains/resolver/PublicResolver"
      );
      PublicResolver.setProvider(this.provider);
      publicResolver = await PublicResolver.new(this.currentRegistryAddress, {
        from
      });
      await ensjs.setResolver(name, publicResolver.address, { from });
    }
    if (resolvedAddress !== address) {
      await ensjs.resolver(name).setAddr(address);
    }
  }
}

module.exports = ENS;
