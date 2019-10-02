import BN from "bn.js";
import { ContractObject } from "@truffle/contract-schema/spec";
import { DecoderContext } from "./contexts";
import { AstDefinition } from "./ast";
import { Types, Values } from "@truffle/codec/format";
import { CalldataDecoding, LogDecoding } from "./decoding";
import { Transaction, BlockType } from "web3/eth/types";
import { Log } from "web3/types";

export interface ContractState {
  name: string;
  balanceAsBN: BN;
  nonceAsBN: BN;
  code: string;
}

export interface DecodedVariable {
  name: string;
  class: Types.ContractType;
  value: Values.Result;
}

export interface DecodedTransaction extends Transaction {
  decoding: CalldataDecoding;
}

export interface DecodedLog extends Log {
  decodings: LogDecoding[];
}

export interface ContractMapping {
  [nodeId: number]: ContractObject;
};

export interface StorageCache {
  [block: number]: {
    [address: string]: {
      [slot: string]: Uint8Array;
    };
  };
}

export interface CodeCache {
  [block: number]: {
    [address: string]: Uint8Array;
  };
}

export interface ContractAndContexts {
  contract: ContractObject;
  node: AstDefinition;
  deployedContext?: DecoderContext;
  constructorContext?: DecoderContext;
}

export interface EventOptions {
  name?: string;
  fromBlock?: BlockType;
  toBlock?: BlockType;
  address?: string; //ignored by contract decoder!
}
