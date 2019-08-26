import debugModule from "debug";
const debug = debugModule("codec:types:storage");

import * as CodecUtils from "truffle-codec-utils";
import { encodeMappingKey } from "../encode/key";
import BN from "bn.js";

export type StorageLength = {bytes: number} | {words: number};

export function isWordsLength(size: StorageLength): size is {words: number} {
  return (<{words: number}>size).words !== undefined;
}

export function storageLengthToBytes(size: StorageLength): number {
  if(isWordsLength(size)) {
    debug("size.words %d", size.words);
    return size.words * CodecUtils.EVM.WORD_SIZE;
  }
  else {
    return size.bytes;
  }
}

export interface Range {
  from: StoragePosition;
  to?: StoragePosition;
  length?: number;
}

export interface StoragePosition {
  slot: Slot;
  index: number;
};

export interface Slot {
  key?: CodecUtils.Values.ElementaryValue;
  path?: Slot;
  hashPath?: boolean;
  offset: BN;
};

//note: this function compares slots mostly by structure,
//rather than by their numerical value
export function equalSlots(slot1: Slot | undefined, slot2: Slot | undefined): boolean {
  if(!slot1 || !slot2) {
    return !slot1 && !slot2; //if either is undefined, it's true only if both are
  }
  if(!slot1.offset.eq(slot2.offset)) {
    return false;
  }
  if(slot1.hashPath !== slot2.hashPath) {
    return false;
  }
  if(!equalSlots(slot1.path, slot2.path)) {
    return false;
  }
  //to compare keys, we'll just compare their hex encodings
  //(yes, that leaves some wiggle room, as it could consider different
  //*types* of keys to be equal, but if keys are the only difference then
  //that should determine those types, so it shouldn't be a problem)
  if(!slot1.key || !slot2.key) {
    //first, though, they likely don't *have* keys
    return !slot1.key && !slot2.key;
  }
  //if they do have keys, though...
  return CodecUtils.EVM.equalData(
    encodeMappingKey(slot1.key),
    encodeMappingKey(slot2.key)
  );
}
