pragma solidity ^0.5.0;

import "truffle/Assert.sol";

contract TestFailures {

  function testAssertFail() {
     Assert.fail("Should error");
  }

  function testAssertEqualFailure(){
    uint a = 10;
    uint b = 1;
    Assert.equal(a, b, "Should error: not equal");
  }
}
