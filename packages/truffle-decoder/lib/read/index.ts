import * as storage from "./storage";
import * as memory from "./memory";
import * as constant from "./constant";
import * as Pointer from "../types/pointer";
import { EvmState } from "../types/evm";
import Web3 from "web3";

export default async function read(pointer: Pointer.DataPointer, state: EvmState, web3?: Web3, contractAddress?: string): Promise<Uint8Array> {
  if (Pointer.isStackPointer(pointer) && state.stack && pointer.stack < state.stack.length) {
    return state.stack[pointer.stack];
  } else if (Pointer.isStoragePointer(pointer) && state.storage) {
    return await storage.readRange(state.storage, pointer.storage, web3, contractAddress);
  } else if (Pointer.isMemoryPointer(pointer) && state.memory) {
    return memory.readBytes(state.memory, pointer.memory.start, pointer.memory.length);
  } else if (Pointer.isStackLiteralPointer(pointer)) {
    return pointer.literal;
  } else if (Pointer.isConstantDefinitionPointer(pointer)) {
    return constant.readDefinition(pointer);
  }
}
