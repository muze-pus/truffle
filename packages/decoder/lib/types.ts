import type BN from "bn.js";
import type { ContractObject as Artifact } from "@truffle/contract-schema/spec";
import type {
  Format,
  Ast,
  Compilations,
  LogDecoding,
  StateVariable,
  ExtrasAllowed
} from "@truffle/codec";
import type { Provider } from "web3/providers";
import type Web3 from "web3";

//StateVariable used to be defined here, so let's continue
//to export it
export { StateVariable, ExtrasAllowed };

/**
 * This type contains information needed to initialize the decoder.
 * @Category Inputs
 */
export interface DecoderSettings {
  /**
   * Information about the project or contracts being decoded.
   * This may come in several forms; see the type documentation for
   * more information.  The simplest way to use this to set it to
   * `{ artifacts: <array of artifacts in project> }`.
   *
   * This may be left out if an artifact or contract has been passed
   * in by some other means, in which case the decoder will be made
   * based purely on that single contract, but it's recommended to pass in
   * project info for all your contracts to get the decoder's full power.
   */
  projectInfo?: Compilations.ProjectInfo;
  /**
   * The provider for the decoder to use.  This is required when using a
   * provider-based constructor; otherwise an exception will be thrown.
   * If the decoder is initialized with a Truffle Contract-based constructor,
   * this is not expected to be passed.  If it is passed, it will override
   * the use of the given contract's provider.
   */
  provider?: Provider;
  /**
   * In the future, it will be possible to include this field to enable or
   * disable ENS resolution.  Currently, it does nothing.
   */
  ens?: EnsSettings;
}

//WARNING: copypasted from @truffle/encoder!
/**
 * In the future, this type will indicates settings to be used for ENS resolution
 * and reverse resolution.  Currently it does nothing.
 * @Category Inputs
 */
export interface EnsSettings {
  /**
   * (This does nothing at present; this description is intended for the future.)
   *
   * The provider to use for ENS resolution; set this to `null` to disable
   * ENS resolution.  If absent, will default to the decoder's provider,
   * and ENS resolution will be enabled.
   */
  provider?: Provider | null;
  /**
   * (This does nothing at present; this description is intended for the future.)
   *
   * The ENS registry address to use; if absent, will use the default one
   * for the current network.  If there is no default registry for the
   * current network, ENS resolution will be disabled.
   */
  registryAddress?: string;
}

/**
 * This type represents the state of a contract aside from its storage.
 * @category Results
 */
export interface ContractState {
  /**
   * The contract's class, as a Format.Types.ContractType.
   */
  class: Format.Types.ContractType;
  /**
   * The contract's address, as a checksummed hex string.
   */
  address: string;
  /**
   * The contract's balance, in Wei, as a BN.
   */
  balanceAsBN: BN;
  /**
   * The contract's nonce, as a BN.
   */
  nonceAsBN: BN;
  /**
   * The contract's code, as a hexidecimal string.
   */
  code: string;
}

/**
 * This type represents a web3 Log object that has been decoded.
 * Note that it extends the Log type and just adds an additional field
 * with the decoding.
 * @category Results
 */
export interface DecodedLog extends Log {
  /**
   * An array of possible decodings of the given log -- it's an array because logs can be ambiguous.
   *
   * This field works just like the output of [[WireDecoder.decodeLog]], so see that for more
   * information.
   */
  decodings: LogDecoding[];
}

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

export interface CompilationAndContract {
  compilation: Compilations.Compilation;
  contract: Compilations.Contract;
}

export interface ContractInfo {
  compilation: Compilations.Compilation;
  contract: Compilations.Contract;
  artifact: Artifact;
  contractNode: Ast.AstNode;
  contractNetwork: string;
  contextHash: string;
}

/**
 * The type of the options parameter to [[WireDecoder.events|events()]].  This type will be expanded in the future
 * as more filtering options are added.
 * @category Inputs
 */
export interface EventOptions {
  /**
   * If included, the name parameter will restrict to events with the given name.
   */
  name?: string;
  /**
   * The earliest block to include events from.  Defaults to "latest".
   */
  fromBlock?: BlockSpecifier;
  /**
   * The latest block to include events from.  Defaults to "latest".
   */
  toBlock?: BlockSpecifier;
  /**
   * If included, will restrict to events emitted by the given address.
   *
   * NOTE: In the contract instance decoder, if omitted, defaults to the
   * address of the contract instance being decoded, rather than not filtering
   * by address.  However, this behavior can be turned off by explicitly specifying
   * address as undefined.
   */
  address?: string;
  /**
   * Used to indicate whether "extra" event decodings -- event decodings from
   * non-library contracts other than the one that appears to have emitted
   * the event -- should be returned.  Defaults to `"off"`.
   */
  extras?: ExtrasAllowed;
}

/**
 * The type of the options parameter to [[WireDecoder.decodeLog|decodeLog()]].
 * This type may be expanded in the future.
 * @category Inputs
 */
export interface DecodeLogOptions {
  /**
   * Used to indicate whether "extra" event decodings -- event decodings from
   * non-library contracts other than the one that appears to have emitted
   * the event -- should be returned.  Defaults to `"off"`.
   */
  extras?: ExtrasAllowed;
}

/**
 * The type of the options parameter to [[ContractDecoder.decodeReturnValue|decodeReturnValue()]].
 * @category Inputs
 */
export interface ReturnOptions {
  /**
   * The block in which the call was made.  Defaults to "latest".
   */
  block?: BlockSpecifier;
  /**
   * If included, tells the decoder to interpret the return data as
   * the return data from a successful call (if `true` is passed) or
   * as the return data from a failed call (if `false` is passed). If
   * omitted or set to `undefined`, the decoder will account for both
   * possibilities.
   */
  status?: boolean | undefined;
}

/**
 * Contains information about a transaction.  Most of the fields have
 * been made optional; only those needed by the decoder have been made
 * mandatory.
 *
 * Intended to work like Web3's
 * [Transaction](https://web3js.readthedocs.io/en/v1.2.1/web3-eth.html#eth-gettransaction-return)
 * type.
 * @category Inputs
 */
export interface Transaction {
  /**
   * The transaction hash as hex string.
   */
  hash?: string;
  /**
   * The nonce of the sender before this transaction was sent.
   */
  nonce?: number;
  /**
   * Hash of this transaction's block as hex string; null if pending.
   */
  blockHash?: string | null;
  /**
   * This transaction's block number; null if pending.
   */
  blockNumber: number | null;
  /**
   * Index of transaction in block; null if block is pending.
   */
  transactionIndex?: number | null;
  /**
   * Address of the sender (as checksummed hex string).
   */
  from?: string;
  /**
   * Address of the recipient (as checksummed hex string), or null for a
   * contract creation.
   */
  to: string | null;
  /**
   * Wei sent with this transaction, as numeric string.
   */
  value?: string;
  /**
   * Gas price for this transaction, as numeric string.
   */
  gasPrice?: string;
  /**
   * Gas provided by the sender, as numeric string.
   */
  gas?: string;
  /**
   * Data sent with the transaction, as hex string.
   */
  input: string;
}

/**
 * Contains information about a transaction.  Most of the fields have
 * been made optional; only those needed by the decoder have been made
 * mandatory.
 *
 * Intended to work like Web3's
 * [Log](https://web3js.readthedocs.io/en/v1.2.1/web3-eth.html#eth-getpastlogs-return)
 * type.
 * @category Inputs
 */
export interface Log {
  /**
   * Address of the emitter (as checksummed hex string).
   */
  address: string;
  /**
   * The log's data section (as hex string).
   */
  data: string;
  /**
   * The log's topics; each is a hex string representing 32 bytes.
   */
  topics: string[];
  /**
   * Index of the log within the block.
   */
  logIndex?: number;
  /**
   * Index within the block of the emitting transaction; null if
   * block is pending.
   */
  transactionIndex?: number | null;
  /**
   * The emitting transaction's hash (as hex string).
   */
  transactionHash?: string;
  /**
   * The block hash (as hex string).  Null if pending.
   */
  blockHash?: string | null;
  /**
   * The block number.  Null if pending.
   */
  blockNumber: number | null;
}

/**
 * Specifies a block.  Can be given by number, or can be given via the
 * special strings "genesis", "latest", or "pending".
 *
 * Intended to work like Web3's
 * [BlockType](https://web3js.readthedocs.io/en/v1.2.1/web3-eth.html#id14).
 *
 * *Warning*: Using "pending", while allowed, is not advised, as it may lead
 * to internally inconsistent results.  Use of "latest" is safe and will not
 * lead to inconsistent results from a single decoder call due to the decoder's
 * caching system, but pending blocks cannot be cached under this system, which
 * may cause inconsistencies.
 * @category Inputs
 */
export type BlockSpecifier = number | "genesis" | "latest" | "pending";

export type RegularizedBlockSpecifier = number | "pending";

//HACK
export interface ContractConstructorObject extends Artifact {
  _json: Artifact;
  web3: Web3;
}

//HACK
export interface ContractInstanceObject {
  constructor: ContractConstructorObject;
  address: string;
}
