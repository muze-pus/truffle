import type { Query } from "@truffle/db/process";
import { generateId, Migrations, WorkspaceClient } from "./utils";
import { AddNetworks, GetNetwork, GetAllNetworks } from "./network.graphql";

describe("Network", () => {
  const wsClient = new WorkspaceClient();
  const expectedHash =
    "0xcba0b90a5e65512202091c12a2e3b328f374715b9f1c8f32cb4600c726fe2aa6";
  const expectedId = generateId("networks", {
    networkId: Object.keys(Migrations.networks)[0],
    historicBlock: {
      height: 1,
      hash: expectedHash
    }
  });

  const variables = {
    name: "ganache",
    networkId: Object.keys(Migrations.networks)[0],
    height: 1,
    hash: expectedHash
  };

  let addNetworksResult;

  beforeEach(async () => {
    addNetworksResult = await wsClient.execute(AddNetworks, {
      name: "ganache",
      networkId: variables.networkId,
      height: variables.height,
      hash: variables.hash
    });
  });

  test("can be added", () => {
    expect(addNetworksResult).toHaveProperty("networksAdd");

    const { networksAdd } = addNetworksResult;
    expect(networksAdd).toHaveProperty("networks");

    const { networks } = networksAdd;
    expect(networks).toHaveLength(1);

    const network = networks[0];
    expect(network).toHaveProperty("id");

    const { id } = network;
    expect(id).toEqual(expectedId);
  });

  test("can be queried", async () => {
    const getNetworkResult = (await wsClient.execute(GetNetwork, {
      id: expectedId
    })) as Query<"network">;

    expect(getNetworkResult).toHaveProperty("network");

    const { network } = getNetworkResult;
    expect(network).toBeDefined();
    expect(network).toHaveProperty("id");
    expect(network).toHaveProperty("networkId");

    // @ts-ignore
    const { id, networkId } = network;
    expect(id).toEqual(expectedId);
    expect(networkId).toEqual(variables.networkId);
  });

  test("can retrieve all networks", async () => {
    const getAllNetworksResult = (await wsClient.execute(
      GetAllNetworks,
      {}
    )) as Query<"networks">;

    expect(getAllNetworksResult).toHaveProperty("networks");

    const { networks } = getAllNetworksResult;
    expect(Array.isArray(networks)).toBeTruthy;

    const network = networks[0];
    expect(network).toHaveProperty("networkId");

    const { id, networkId } = network;
    expect(id).toEqual(expectedId);
    expect(networkId).toEqual(variables.networkId);
  });
});
