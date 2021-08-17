import type * as Common from "@truffle/codec/common";
import type * as Storage from "@truffle/codec/storage/types";
import type * as Ast from "@truffle/codec/ast";
import type {
  StorageAllocations,
  StateAllocations
} from "@truffle/codec/storage/allocate/types";
import type { MemoryAllocations } from "@truffle/codec/memory/allocate/types";
import type {
  AbiAllocations,
  CalldataAllocations,
  ReturndataAllocations,
  EventAllocations
} from "@truffle/codec/abi-data/allocate/types";
import type * as Contexts from "@truffle/codec/contexts/types";
import type * as Format from "@truffle/codec/format";

export interface EvmState {
  storage: WordMapping;
  stack?: Uint8Array[];
  memory?: Uint8Array;
  calldata?: Uint8Array;
  code?: Uint8Array;
  specials?: {
    [builtin: string]: Uint8Array; //sorry
  };
  eventdata?: Uint8Array;
  eventtopics?: Uint8Array[];
  returndata?: Uint8Array;
}

export interface WordMapping {
  [slotAddress: string]: Uint8Array;
}

export interface EvmInfo {
  state: EvmState;
  mappingKeys?: Storage.Slot[];
  userDefinedTypes?: Format.Types.TypesById;
  allocations: AllocationInfo;
  contexts?: Contexts.Contexts;
  currentContext?: Contexts.Context;
  internalFunctionsTable?: InternalFunctions;
}

export interface AllocationInfo {
  storage?: StorageAllocations;
  memory?: MemoryAllocations;
  abi?: AbiAllocations;
  calldata?: CalldataAllocations;
  returndata?: ReturndataAllocations; //just for custom errors
  event?: EventAllocations;
  state?: StateAllocations;
}

export interface InternalFunctions {
  [pc: number]: InternalFunction;
}

export interface InternalFunction {
  sourceIndex?: number;
  compilationId?: string;
  pointer?: string;
  node?: Ast.AstNode;
  name?: string;
  id?: number;
  mutability?: Common.Mutability;
  contractPointer?: string;
  contractNode?: Ast.AstNode;
  contractName?: string;
  contractId?: number;
  contractKind?: Common.ContractKind;
  contractPayable?: boolean;
  isDesignatedInvalid: boolean;
}
