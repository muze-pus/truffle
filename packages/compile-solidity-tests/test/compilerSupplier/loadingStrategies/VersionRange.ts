import { assert } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import * as fs from "fs";
import axios from "axios";
import * as sinon from "sinon";
import { LoadingStrategies } from "@truffle/compile-solidity";
import Config from "@truffle/config";

const config = Config.default();
let versionRangeOptions = {
  events: config.events,
  solcConfig: config.compilers.solc
};
const instance = new LoadingStrategies.VersionRange(versionRangeOptions);
let fileName, expectedResult;
const compilerFileNames = [
  "soljson-v0.4.22+commit.124ca40d.js",
  "soljson-v0.4.23+commit.1534a40d.js",
  "soljson-v0.4.11+commit.124234rd.js"
];

const allVersions = {
  builds: [
    {
      path: "soljson-v0.1.1+commit.6ff4cd6.js",
      version: "0.1.1",
      build: "commit.6ff4cd6",
      longVersion: "0.1.1+commit.6ff4cd6",
      keccak256:
        "0xd8b8c64f4e9de41e6604e6ac30274eff5b80f831f8534f0ad85ec0aff466bb25",
      urls: [
        "bzzr://8f3c028825a1b72645f46920b67dca9432a87fc37a8940a2b2ce1dd6ddc2e29b"
      ]
    },
    {
      path: "soljson-v0.5.1+commit.c8a2cb62.js",
      version: "0.5.1",
      build: "commit.c8a2cb62",
      longVersion: "0.5.1+commit.c8a2cb62",
      keccak256:
        "0xa70b3d4acf77a303efa93c3ddcadd55b8762c7be109fd8f259ec7d6be654f03e",
      urls: [
        "bzzr://e662d71e9b8e1b0311c129b962e678e5dd63487ad9b020ee539d7f74cd7392c9"
      ]
    }
  ],
  releases: {
    "0.5.4": "soljson-v0.5.4+commit.9549d8ff.js",
    "0.5.3": "soljson-v0.5.3+commit.10d17f24.js",
    "0.5.2": "soljson-v0.5.2+commit.1df8f40c.js",
    "0.5.1": "soljson-v0.5.1+commit.c8a2cb62.js",
    "0.5.0": "soljson-v0.5.0+commit.1d4f565a.js",
    "0.4.25": "soljson-v0.4.25+commit.59dbf8f1.js",
    "0.4.24": "soljson-v0.4.24+commit.e67f0147.js",
    "0.4.23": "soljson-v0.4.23+commit.124ca40d.js",
    "0.4.22": "soljson-v0.4.22+commit.4cb486ee.js"
  },
  latestRelease: "0.5.4"
};

const unStub = (stubbedThing: object, methodName: string): void => {
  stubbedThing[methodName].restore();
};

describe("VersionRange loading strategy", () => {
  beforeEach(function () {
    sinon
      .stub(instance, "getSolcVersionsForSource")
      .returns(Promise.resolve(allVersions));
  });
  afterEach(function () {
    unStub(instance, "getSolcVersionsForSource");
  });

  describe("async load(versionRange)", () => {
    beforeEach(() => {
      sinon.stub(instance, "getCachedSolcByVersionRange");
      sinon.stub(instance, "getSolcFromCacheOrUrl");
      sinon.stub(instance, "versionIsCached").returns(undefined);
    });
    afterEach(() => {
      unStub(instance, "getCachedSolcByVersionRange");
      unStub(instance, "getSolcFromCacheOrUrl");
      unStub(instance, "versionIsCached");
    });

    it("calls getCachedSolcByVersionRange when single solc is specified", async () => {
      await instance.load("0.5.0");
      // @ts-ignore - TS not smart enough to recognize stubbed methods
      assert(instance.getCachedSolcByVersionRange.called);
    });
    it("calls getSolcFromCacheOrUrl when a larger range is specified", async () => {
      await instance.load("^0.5.0");
      // @ts-ignore
      assert(instance.getSolcFromCacheOrUrl.called);
    });
  });

  describe("getSolcFromCacheOrUrl(version)", () => {
    beforeEach(() => {
      sinon.stub(instance, "getCachedSolcByFileName");
    });
    afterEach(() => {
      unStub(instance, "getCachedSolcByFileName");
    });

    describe("when a version constraint is specified", () => {
      beforeEach(() => {
        sinon.stub(instance, "getAndCacheSolcByUrl");
        sinon.stub(instance.cache, "has").returns(false);
      });
      afterEach(() => {
        unStub(instance, "getAndCacheSolcByUrl");
        unStub(instance.cache, "has");
      });

      it("calls findNewstValidVersion to determine which version to fetch", async () => {
        await instance.getSolcFromCacheOrUrl("^0.5.0");
        assert(
          // @ts-ignore
          instance.getAndCacheSolcByUrl.calledWith(
            "soljson-v0.5.4+commit.9549d8ff.js"
          ),
          "getAndCacheSolcByUrl not called with the compiler file name"
        );
      });
    });

    describe("when the version is cached", () => {
      beforeEach(() => {
        sinon.stub(instance.cache, "has").returns(true);
      });
      afterEach(() => {
        unStub(instance.cache, "has");
      });

      it("calls getCachedSolcByFileName", async () => {
        await instance.getSolcFromCacheOrUrl("0.5.0");
        assert(
          // @ts-ignore
          instance.getCachedSolcByFileName.calledWith(
            "soljson-v0.5.0+commit.1d4f565a.js"
          )
        );
      });
    });

    describe("when the version is not cached", () => {
      beforeEach(() => {
        sinon.stub(instance.cache, "has").returns(false);
        sinon.stub(instance.cache, "add");
        sinon.stub(instance, "compilerFromString").returns("compiler");
      });
      afterEach(() => {
        unStub(instance.cache, "has");
        unStub(instance.cache, "add");
        unStub(instance, "compilerFromString");
      });

      it("eventually calls add and compilerFromString", async () => {
        await instance.getSolcFromCacheOrUrl("0.5.1");
        // @ts-ignore
        assert(instance.cache.add.called);
        // @ts-ignore
        assert(instance.compilerFromString.called);
      }).timeout(60000);
    });
  });

  describe(".getAndCacheSolcByUrl(fileName)", () => {
    beforeEach(() => {
      fileName = "someSolcFile";
      sinon
        .stub(axios, "get")
        .withArgs(`${instance.config.compilerRoots![0]}${fileName}`)
        .returns(Promise.resolve({ data: "requestReturn" }));
      // @ts-ignore
      sinon.stub(instance.cache, "add").withArgs("requestReturn");
      sinon
        .stub(instance, "compilerFromString")
        .withArgs("requestReturn")
        .returns("success");
    });
    afterEach(() => {
      unStub(axios, "get");
      unStub(instance.cache, "add");
      unStub(instance, "compilerFromString");
    });

    it("calls add with the response and the file name", async () => {
      const result = await instance.getAndCacheSolcByUrl(fileName, 0);
      // @ts-ignore
      assert(instance.cache.add.calledWith("requestReturn", "someSolcFile"));
      assert.equal(result, "success");
    });
  });

  describe(".findNewestValidVersion(version, allVersions)", () => {
    it("returns the version name of the newest valid version", () => {
      const expectedResult = "0.5.4";
      assert.equal(
        instance.findNewestValidVersion("^0.5.0", allVersions),
        expectedResult
      );
    });
    it("returns null when the version is invalid", () => {
      assert.isNull(
        instance.findNewestValidVersion("garbageInput", allVersions)
      );
    });
    it("returns null when there are no valid versions", () => {
      assert.isNull(instance.findNewestValidVersion("^0.8.0", allVersions));
    });
  });

  describe("versionIsCached(version)", () => {
    beforeEach(() => {
      // readdirSync returns fs.Dirent objects rather than just plain paths
      sinon
        .stub(fs, "readdirSync")
        .returns(compilerFileNames as unknown as fs.Dirent[]);
    });
    afterEach(() => {
      unStub(fs, "readdirSync");
    });

    describe("when a cached version of the compiler is present", () => {
      beforeEach(() => {
        expectedResult = "v0.4.11+commit.124234rd.js";
      });

      it("returns the file name with the prefix removed", () => {
        assert.equal(instance.versionIsCached("0.4.11"), expectedResult);
      });
    });

    describe("when a cached version of the compiler is not present", () => {
      beforeEach(() => {
        expectedResult = undefined;
      });

      it("returns undefined", () => {
        assert.equal(instance.versionIsCached("0.4.29"), expectedResult);
      });
    });
  });

  describe("getCachedSolcByVersionRange(version)", () => {
    beforeEach(() => {
      expectedResult = "soljson-v0.4.23+commit.1534a40d.js";
      sinon
        .stub(fs, "readdirSync")
        .returns(compilerFileNames as unknown as fs.Dirent[]);
      sinon.stub(instance, "getCachedSolcByFileName");
    });
    afterEach(() => {
      unStub(fs, "readdirSync");
      unStub(instance, "getCachedSolcByFileName");
    });

    it("returns the compiler when a single version is specified", () => {
      instance.getCachedSolcByVersionRange("0.4.23");
      // @ts-ignore
      assert(instance.getCachedSolcByFileName.calledWith(expectedResult));
    });
    it("returns the newest compiler when there are multiple valid ones", () => {
      instance.getCachedSolcByVersionRange("^0.4.1");
      // @ts-ignore
      assert(instance.getCachedSolcByFileName.calledWith(expectedResult));
    });
  });
});
