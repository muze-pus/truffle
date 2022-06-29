import { describe, it, beforeEach, afterEach } from "mocha";
import Ganache from "ganache";
import { assert } from "chai";
import HDWalletProvider from "..";
import { promisify } from "util";
import { getTypedData } from "./helpers";
import type { Provider } from "../src/constructor/types";
let ganacheProvider: any, hdwallet: HDWalletProvider, msgParams_v4: any;

describe("eth_signTypedData_v4", function () {
  beforeEach(async function () {
    ganacheProvider = Ganache.provider({
      miner: {
        instamine: "strict"
      },
      logging: {
        quiet: true
      }
    });
    const mnemonic =
      "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";
    hdwallet = new HDWalletProvider({
      mnemonic,
      providerOrUrl: ganacheProvider as Provider
    });
    const { result } = await promisify(
      ganacheProvider.send.bind(ganacheProvider)
    )({
      method: "eth_chainId",
      jsonrpc: "2.0",
      id: 999,
      params: []
    });
    const chainId = parseInt(result);
    msgParams_v4 = JSON.stringify(getTypedData(chainId));
  });

  afterEach(async function () {
    await ganacheProvider.disconnect();
  });

  it("signs typed data", async function () {
    const { result } = await promisify(hdwallet.send.bind(hdwallet))({
      method: "eth_signTypedData_v4",
      params: ["0x627306090abab3a6e1400e9345bc60c78a8bef57", msgParams_v4],
      jsonrpc: "2.0",
      id: 1
    });
    const expectedResult =
      "0xbc12f50c57213e1ce05a904541e8cdeebd25fdd4aac1fe07dc99ec1dd940f5a86fecfb1c3567cd5d64635694fba4a8fd9415c4b35192002108912d65d57570811c";
    assert.equal(result, expectedResult);
  });
});
