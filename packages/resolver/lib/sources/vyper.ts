import debugModule from "debug";
const debug = debugModule("resolver:sources:vyper");
import path from "path";
import type { ContractObject } from "@truffle/contract-schema/spec";
import type { ResolverSource, SourceResolution } from "../source";

export class Vyper implements ResolverSource {
  contractsDirectory: string;
  wrappedSources: ResolverSource[];
  //because this ResolverSource has to do an actual resolution just to
  //do a resolveDependencyPath, I'm giving it a cache to prevent redoing
  //the work of resolution later
  cache: {
    [filePath: string]: SourceResolution;
  };

  constructor(wrappedSources: ResolverSource[], contractsDirectory: string) {
    this.wrappedSources = wrappedSources;
    this.cache = {};
    this.contractsDirectory = contractsDirectory;
  }

  require(): ContractObject | null {
    //out of scope for this resolver source
    return null;
  }

  async resolve(importModule: string, importedFrom: string) {
    importedFrom = importedFrom || "";

    debug("importModule: %s", importModule);
    debug("importedFrom: %s", importedFrom);

    //attempt to just resolve as if it's a file path rather than Vyper module
    for (const source of this.wrappedSources) {
      const directlyResolvedSource = await source.resolve(
        importModule,
        importedFrom
      );
      if (directlyResolvedSource.body !== undefined) {
        debug("found directly");
        return directlyResolvedSource;
      }
    }
    //otherwise, it's time for some Vyper module processing...

    //only attempt this if what we have looks like a Vyper module
    if (!importModule.match(/^[\w.]+$/)) {
      debug("clearly not a Vyper module");
      return { body: undefined, filePath: undefined };
    }

    const importPath = moduleToPath(importModule); //note: no file extension yet
    debug("importPath: %s", importPath);
    const explicitlyRelative = importModule[0] === "."; //note we check importModule,
    //not importPath, to make the check simpler (can just check if begins with "."
    //rather than "./" or "../")
    debug("explicitlyRelative: %o", explicitlyRelative);

    const possiblePathsMinusExtension: string[] = [];
    //first: check in local directory
    possiblePathsMinusExtension.push(
      path.join(path.dirname(importedFrom), importPath)
    );
    if (!explicitlyRelative) {
      //next: check in contracts dir, if not explicitly relative
      possiblePathsMinusExtension.push(
        path.join(this.contractsDirectory, importPath)
      );
      //finally: check wherever the resolver says to check
      possiblePathsMinusExtension.push(importPath);
    }
    const possibleExtensions = [".json", ".vy"]; //Vyper only expects these two
    //note: this puts all JSON before all Vyper, which is how we want it
    //(we do not want to try Vyper from any sources until JSON from all sources
    //has been checked)
    const possiblePaths = [].concat(
      ...possibleExtensions.map(extension =>
        possiblePathsMinusExtension.map(path => path + extension)
      )
    );

    debug("possiblePaths: %O", possiblePaths);

    for (const possiblePath of possiblePaths) {
      debug("possiblePath: %s", possiblePath);
      let resolvedSource;
      if (possiblePath in this.cache) {
        resolvedSource = this.cache[possiblePath];
      } else {
        for (const source of this.wrappedSources) {
          debug("source: %o", source);
          resolvedSource = await source.resolve(possiblePath, importedFrom);
          if (resolvedSource.body !== undefined) {
            debug("found via this source");
            break;
          }
        }
        this.cache[possiblePath] = resolvedSource; //yes, even failures are cached!
      }

      if (resolvedSource.body !== undefined) {
        debug("found");
        return resolvedSource;
      }
      debug("not found");
    }

    //if not found, return nothing
    return { body: undefined, filePath: undefined };
  }

  async resolveDependencyPath(importPath: string, dependencyPath: string) {
    //unfortunately, for this sort of source to resolve a dependency path,
    //it's going to need to do a resolve :-/
    debug("importPath: %s", importPath);
    const resolved = await this.resolve(dependencyPath, importPath);
    if (resolved) {
      return resolved.filePath;
    } else {
      return null;
    }
  }
}

function moduleToPath(moduleName: string): string {
  //first: get initial dot count by matching against regular expression for
  //initial dots, then taking captured group (note: regular expression
  //will always match so don't have to worry about null here) and taking
  //length
  const initialDotCount = moduleName.match(/^(\.*)/)[1].length;
  //then: change rest of dots to slashes
  const withoutInitialDots = moduleName.slice(initialDotCount);
  const pathWithoutDots = withoutInitialDots.replace(/\./g, path.sep);
  let initialDotPath;
  //then: interpret initial dots
  switch (initialDotCount) {
    case 0:
      initialDotPath = "";
      break;
    case 1:
      initialDotPath = "./";
      break;
    default:
      initialDotPath = "../".repeat(initialDotCount - 1);
      break;
  }
  //finally: combine
  return initialDotPath + pathWithoutDots;
}
