import * as CodeUtils from "../src";
import assert from "assert";
import { describe, it } from "mocha";

describe("CodeUtils.parseCode", function () {
  // example contract hex code
  const contractHexCode =
    "0x60806040526004361061004c576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff16806371dc61cb14610051578063ca4bc9eb146100ba575b600080fd5b34801561005d57600080fd5b506100b8600480360381019080803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284378201915050505050509192919290505050610176565b005b3480156100c657600080fd5b506100fb600480360381019080803573ffffffffffffffffffffffffffffffffffffffff1690602001909291905050506101cc565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561013b578082015181840152602081019050610120565b50505050905090810190601f1680156101685780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b806000803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002090805190602001906101c892919061027c565b5050565b60006020528060005260406000206000915090508054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156102745780601f1061024957610100808354040283529160200191610274565b820191906000526020600020905b81548152906001019060200180831161025757829003601f168201915b505050505081565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106102bd57805160ff19168380011785556102eb565b828001600101855582156102eb579182015b828111156102ea5782518255916020019190600101906102cf565b5b5090506102f891906102fc565b5090565b61031e91905b8082111561031a576000816000905550600101610302565b5090565b905600a165627a7a723058201e83a8ab1e70123d8d8f6d7bf1e3edb7be768977f2faaa0d7fc0463ef14e98c70029";

  it("returns an array of instructions", function () {
    const parsedCode = CodeUtils.parseCode(contractHexCode, {
      attemptStripMetadata: true
    });
    assert(parsedCode);
    assert(Array.isArray(parsedCode));
  });

  it("returns an empty array when passed an empty string array", function () {
    const parsedCode = CodeUtils.parseCode("[]");
    assert(parsedCode);
    assert(Array.isArray(parsedCode));
    assert.equal(parsedCode.length, 0);
  });

  it("doesn't strip invalid metadata", function () {
    const bytecode =
      "0x600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600050600060000100";
    const parsedCode = CodeUtils.parseCode(bytecode, {
      attemptStripMetadata: true
    });
    assert(parsedCode);
    assert.equal(parsedCode.length, 172);
  });

  it("doesn't crash on invalid metadata", function () {
    //this particular example used to crash things...
    const bytecode =
      "0x341561000a57600080fd5b60043610156100185761041b565b600035601c5274012a05f1fffffffffffffffffffffffffdabf41c006080527ffffffffffffffffffffffffed5fa0e000000000000000000000000000000000060a052635de6ac1c60005114156100af5760043560011c1561007957600080fd5b60243560011c1561008957600080fd5b600435156100995760243561009c565b60005b610140526101405160005260206000f350005b638a50fecb60005114156100ec576004356024358181830110156100d257600080fd5b80820190509050610140526101405160005260206000f350005b639e55f9a76000511415610176576004358080600081121561010a57195b607f1c1561011757600080fd5b9050506024358080600081121561012a57195b607f1c1561013757600080fd5b9050506004356024358082018080600081121561015057195b607f1c1561015d57600080fd5b905090509050610140526101405160005260206000f350005b63eff7cbde60005114156101c55760043560243560a051818301806080519013156101a057600080fd5b80919012156101ae57600080fd5b90509050610140526101405160005260206000f350005b63329cadb760005114156101f85760043560a01c156101e357600080fd5b6004356101405260043560005260206000f350005b634d5b30e9600051141561021c57600435610140526101405160005260206000f350005b63a2f5b19260005114156102c957606060043560040161014037604060043560040135111561024a57600080fd5b6101408051602001806101c08284600060045af161026757600080fd5b50506101c08051602001806102808284600060045af161028657600080fd5b505061028051806102a001818260206001820306601f82010390500336823750506020610260526040610280510160206001820306601f8201039050610260f350005b63d2bc64c760005114156103765760606004356004016101403760406004356004013511156102f757600080fd5b6101408051602001806101c08284600060045af161031457600080fd5b50506101c08051602001806102808284600060045af161033357600080fd5b505061028051806102a001818260206001820306601f82010390500336823750506020610260526040610280510160206001820306601f8201039050610260f350005b63f3ae0c2160005114156103a7576004803561014052806020013561016052806040013561018052506060610140f3005b63ab9af14d60005114156103fe57610140600480358252806020013582602001525050610140610180808080845181525050602081019050808084602001518152505060409050905060c05260c051610180f39050005b63a31d2cf3600051141561041a57600a5460005260206000f350005b5b60006000fd";
    CodeUtils.parseCode(bytecode, { attemptStripMetadata: true });
  });
});
