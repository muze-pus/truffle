import debugModule from "debug";
const debug = debugModule("decoder:decode:stack");

import * as DecodeUtils from "truffle-decode-utils";
import decodeValue from "./value";
import { decodeMemoryReference } from "./memory";
import { decodeStorageReference, decodeStorageByAddress } from "./storage";
import { storageSize } from "../allocate/storage";
import { StackPointer } from "../types/pointer";
import { EvmInfo } from "../types/evm";
import Web3 from "web3";

export default async function decodeStack(definition: DecodeUtils.AstDefinition, pointer: StackPointer, info: EvmInfo, web3?: Web3, contractAddress?: string): Promise <any> {

  //first: do we have a memory pointer? if so we can just dispatch to
  //decodeMemoryReference, which knows how to decode the pointer already
  if(DecodeUtils.Definition.isReference(definition)
    && DecodeUtils.Definition.referenceType(definition) === "memory") {
    return await decodeMemoryReference(definition, pointer, info);
  }

  //next: do we have a storage pointer (which may be a mapping)? if so, we can
  //we dispatch to decodeStorageByAddress, a new function that will decode the
  //pointer and then dispatch to decodeStorateReference
  if((DecodeUtils.Definition.isReference(definition)
    && DecodeUtils.Definition.referenceType(definition) === "storage")
    || DecodeUtils.Definition.isMapping(definition)) {
    return await decodeStorageByAddress(definition, pointer, info, web3, contractAddress);
  }

  //next: do we have a calldata pointer?  we don't support this case yet, so,
  //let's move on

  //next: do we have an external function?  these work differently on the stack
  //than elsewhere, so we can't just pass it on to decodeValue.  However, we
  //don't yet support this case either, so again we'll move on.

  //finally, if none of the above hold, we can just dispatch to decodeValue.
  //note we don't need web3 and contract address at this point
  return await decodeValue(definition, pointer, info);
}
