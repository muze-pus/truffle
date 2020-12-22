import debugModule from "debug";
const debug = debugModule("codec:contexts:utils");

import * as Evm from "@truffle/codec/evm";
import { Context, Contexts } from "./types";
import escapeRegExp from "lodash.escaperegexp";
import * as cbor from "cbor";

export function findContext(
  contexts: Contexts,
  binary: string
): Context | null {
  const matchingContexts = Object.values(contexts).filter(context =>
    matchContext(context, binary)
  );
  //rather than just pick an arbitrary matching context, we're going
  //to pick one that isn't a descendant of any of the others.
  //(if there are multiple of *those*, then yeah it's arbitrary.)
  const context = matchingContexts.find(
    descendant =>
      !matchingContexts.some(
        ancestor =>
          descendant.compilationId === ancestor.compilationId &&
          descendant.linearizedBaseContracts &&
          ancestor.contractId !== undefined &&
          descendant.linearizedBaseContracts
            .slice(1)
            .includes(ancestor.contractId)
        //we do slice one because everything is an an ancestor of itself; we only
        //care about *proper* ancestors
      )
  );
  return context || null;
}

export function matchContext(context: Context, givenBinary: string): boolean {
  let { binary, isConstructor } = context;
  let lengthDifference = givenBinary.length - binary.length;
  //first: if it's not a constructor, they'd better be equal in length.
  //if it is a constructor, the given binary must be at least as long,
  //and the difference must be a multiple of 64
  if (
    (!isConstructor && lengthDifference !== 0) ||
    lengthDifference < 0 ||
    lengthDifference % (2 * Evm.Utils.WORD_SIZE) !== 0
  ) {
    return false;
  }
  for (let i = 0; i < binary.length; i++) {
    //note: using strings like arrays is kind of dangerous in general in JS,
    //but everything here is ASCII so it's fine
    //note that we need to compare case-insensitive, since Solidity will
    //put addresses in checksum case in the compiled source
    //(we don't actually need that second toLowerCase(), but whatever)
    if (
      binary[i] !== "." &&
      binary[i].toLowerCase() !== givenBinary[i].toLowerCase()
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeContexts(contexts: Contexts): Contexts {
  //unfortunately, due to our current link references format, we can't
  //really use the binary from the artifact directly -- neither for purposes
  //of matching, nor for purposes of decoding internal functions.  So, we
  //need to perform this normalization step on our contexts before using
  //them.  Once we have truffle-db, this step should largely go away.

  debug("normalizing contexts");

  //first, let's clone the input
  //(let's do a 2-deep clone because we'll be altering binary)
  let newContexts: Contexts = Object.assign(
    {},
    ...Object.entries(contexts).map(([contextHash, context]) => ({
      [contextHash]: { ...context }
    }))
  );

  debug("contexts cloned");

  //next, we get all the library names and sort them descending by length.
  //We're going to want to go in descending order of length so that we
  //don't run into problems when one name is a substring of another.
  //For simplicity, we'll exclude names of length <38, because we can
  //handle these with our more general check for link references at the end
  const fillerLength = 2 * Evm.Utils.ADDRESS_SIZE;
  let names = Object.values(newContexts)
    .filter(context => context.contractKind === "library")
    .map(context => context.contractName)
    .filter(name => name.length >= fillerLength - 3)
    //the -3 is for 2 leading underscores and 1 trailing
    .sort((name1, name2) => name2.length - name1.length);

  debug("names sorted");

  //now, we need to turn all these names into regular expressions, because,
  //unfortunately, str.replace() will only replace all if you use a /g regexp;
  //note that because names may contain '$', we need to escape them
  //(also we prepend "__" because that's the placeholder format)
  let regexps = names.map(name => new RegExp(escapeRegExp("__" + name), "g"));

  debug("regexps prepared");

  //having done so, we can do the replace for these names!
  const replacement = ".".repeat(fillerLength);
  for (let regexp of regexps) {
    for (let context of Object.values(newContexts)) {
      context.binary = context.binary.replace(regexp, replacement);
    }
  }

  debug("long replacements complete");

  //now we can do a generic replace that will catch all names of length
  //<40, while also catching the Solidity compiler's link reference format
  //as well as Truffle's.  Hooray!
  const genericRegexp = new RegExp("_.{" + (fillerLength - 2) + "}_", "g");
  //we're constructing the regexp /_.{38}_/g, but I didn't want to use a
  //literal 38 :P
  for (let context of Object.values(newContexts)) {
    context.binary = context.binary.replace(genericRegexp, replacement);
  }

  debug("short replacements complete");
  //now we must handle the delegatecall guard -- libraries' deployedBytecode will include
  //0s in place of their own address instead of a link reference at the
  //beginning, so we need to account for that too
  const pushAddressInstruction = (0x60 + Evm.Utils.ADDRESS_SIZE - 1).toString(
    16
  ); //"73"
  for (let context of Object.values(newContexts)) {
    if (context.contractKind === "library" && !context.isConstructor) {
      context.binary = context.binary.replace(
        "0x" + pushAddressInstruction + "00".repeat(Evm.Utils.ADDRESS_SIZE),
        "0x" + pushAddressInstruction + replacement
      );
    }
  }

  debug("extra library replacements complete");

  //now let's handle immutable references
  //(these are much nicer than link references due to not having to deal with the old format)
  for (let context of Object.values(newContexts)) {
    if (context.immutableReferences) {
      for (let variable of Object.values(context.immutableReferences)) {
        for (let { start, length } of <{ start: number; length: number }[]>(
          variable
        )) {
          //Goddammit TS
          let lowerStringIndex = 2 + 2 * start;
          let upperStringIndex = 2 + 2 * (start + length);
          context.binary =
            context.binary.slice(0, lowerStringIndex) +
            "..".repeat(length) +
            context.binary.slice(upperStringIndex);
        }
      }
    }
  }

  debug("immutables complete");

  //one last step: where there's CBOR with a metadata hash, we'll allow the
  //CBOR to vary, aside from the length (note: ideally here we would *only*
  //dot-out the metadata hash part of the CBOR, but, well, it's not worth the
  //trouble to detect that; doing that could potentially get pretty involved)
  //note that if the code isn't Solidity, that's fine -- we just won't get
  //valid CBOR and will not end up adding to our list of regular expressions
  const externalCborInfo = Object.values(newContexts)
    .map(context => extractCborInfo(context.binary))
    .filter(
      cborSegment => cborSegment !== null && isCborWithHash(cborSegment.cbor)
    );
  const cborRegexps = externalCborInfo.map(cborInfo => ({
    input: new RegExp(cborInfo.cborSegment, "g"), //hex string so no need for escape
    output: "..".repeat(cborInfo.cborLength) + cborInfo.cborLengthHex
  }));
  //HACK: we will replace *every* occurrence of *every* external CBOR occurring
  //in *every* context, in order to cover created contracts (including if there
  //are multiple or recursive ones)
  for (let context of Object.values(newContexts)) {
    for (let { input, output } of cborRegexps) {
      context.binary = context.binary.replace(input, output);
    }
  }

  debug("external wildcards complete");

  //finally, return this mess!
  return newContexts;
}

interface CborInfo {
  cborStart: number;
  cborLength: number;
  cborEnd: number;
  cborLengthHex: string;
  cbor: string;
  cborSegment: string;
}

function extractCborInfo(binary: string): CborInfo | null {
  debug("extracting cbor segement of %s", binary);
  const lastTwoBytes = binary.slice(2).slice(-2 * 2); //2 bytes * 2 for hex
  //the slice(2) there may seem unnecessary; it's to handle the possibility that the contract
  //has less than two bytes in its bytecode (that won't happen with Solidity, but let's be
  //certain)
  if (lastTwoBytes.length < 2 * 2) {
    return null; //don't try to handle this case!
  }
  const cborLength: number = parseInt(lastTwoBytes, 16);
  const cborEnd = binary.length - 2 * 2;
  const cborStart = cborEnd - cborLength * 2;
  //sanity check
  if (cborStart < 2) {
    //"0x"
    return null; //don't try to handle this case!
  }
  const cbor = binary.slice(cborStart, cborEnd);
  return {
    cborStart,
    cborLength,
    cborEnd,
    cborLengthHex: lastTwoBytes,
    cbor,
    cborSegment: cbor + lastTwoBytes
  };
}

function isCborWithHash(encoded: string): boolean {
  debug("checking cbor, encoed: %s", encoded);
  let decoded: any;
  try {
    //note this *will* throw if there's data left over,
    //which is what we want it to do
    decoded = cbor.decodeFirstSync(encoded);
  } catch {
    debug("invalid cbor!");
    return false;
  }
  debug("decoded: %O", decoded);
  if (typeof decoded !== "object") {
    return false;
  }
  //borc sometimes returns maps and sometimes objects,
  //so let's make things consistent by converting to a map
  if (!(decoded instanceof Map)) {
    decoded = new Map(Object.entries(decoded));
  }
  const hashKeys = ["bzzr0", "bzzr1", "ipfs"];
  return hashKeys.some(key => decoded.has(key));
}
