import { logger } from "@truffle/db/logger";
const debug = logger("db:meta:batch");

import type { $ } from "hkts/src";

import type { Collections } from "@truffle/db/meta/collections";
import type { Process } from "@truffle/db/meta/process";

export type Configure<C extends Collections = Collections> = <B extends Batch>(
  options: Options<B>
) => <I extends Input<B>, O extends Output<B>>(
  inputs: Inputs<B, I>
) => Process<C, Outputs<B, O>>;

/**
 * Configure a batch process to query and/or mutate resources.
 *
 * Batch processes take structured inputs, split those up and extract a list
 * of entries that can be passed to some process. Given the results of that
 * process, each result is then converted back to some output form and arranged
 * into the same given structure as outputs.
 *
 * This abstraction makes it easier to build bulk iteractions with @truffle/db,
 * rather than, say, submitting multiple separate add mutations.
 *
 * For instance, Truffle artifacts each contain two bytecodes - to minimize the
 * number of `bytecodesAdd` queries, one might want to convert each input
 * artifact to a flat list of bytecodes, execute a single mutation request to
 * @truffle/db, and then automatically pair the resulting bytecode IDs with the
 * respective artifact bytecodes.
 *
 * The process is roughly as follows:
 *
 *
 *   ,--------.  iterate()  ,----------.  extract()  ,---------.
 *   | Inputs |     -->     | Input... |     -->     | Entry[] |
 *   `--------'             `----------'             `---------'
 *
 *       |                                            |
 *       |  initialize()                              |  process()
 *       V                                            V
 *
 *   ,---------.  merge()   ,----------.  convert() ,----------.
 *   | Outputs |    <--     | Output[] |     <--    | Result[] |
 *   `---------'            `----------'            `----------'
 *
 *
 */
export const configure: Configure = <B extends Batch>(options: Options<B>) => {
  return function* <I extends Input<B>, O extends Output<B>>(
    inputs: Inputs<B, I>
  ): Process<Collections, Outputs<B, O>> {
    const {
      process,
      extract,
      convert,
      iterate,
      find,
      initialize,
      merge
    } = options as Options<B, I, O>;

    // iterate over inputs, collect entries and breadcrumbs
    const entries: Entries<B> = [];
    const breadcrumbs: Breadcrumbs<B> = {};
    for (const { input, breadcrumb } of iterate({ inputs })) {
      // extract entry
      const entry: Entry<B> = extract({ input, inputs, breadcrumb });

      breadcrumbs[entries.length] = breadcrumb;

      entries.push(entry);
    }

    // process entries into results
    const results = yield* process({ entries, inputs });

    return results.reduce(
      (outputs: Outputs<B, O>, result: Result<B>, index: number) => {
        const breadcrumb = breadcrumbs[index];
        // find original input based on breadcrumb
        const input = find({ inputs, breadcrumb });

        // convert result and input material to output
        const output = convert({ result, input, inputs });

        // merge in output
        return merge({ outputs, output, breadcrumb });
      },

      // initialize outputs as starting point
      initialize({ inputs })
    );
  };
};

/**
 * Describes a batch process for querying and/or mutating resources
 */
export type Options<
  B extends Batch,
  I extends Input<B> = Input<B>,
  O extends Output<B> = Output<B>
> = {
  /**
   * Describes how to traverse the particular Inputs structure to produce
   * an Iterable of each Input along with a breadcrumb to describe how to
   * place that input in the parent structure.
   */
  iterate(options: {
    inputs: Inputs<B, I>;
  }): Iterable<{
    input: I;
    breadcrumb: Breadcrumb<B>;
  }>;

  /**
   */
  find(options: { inputs: Inputs<B, I>; breadcrumb: Breadcrumb<B> }): I;

  /**
   */
  extract(options: {
    input: I;
    inputs: Inputs<B, I>;
    breadcrumb: Breadcrumb<B>;
  }): Entry<B>;

  /**
   */
  process(options: {
    entries: Entries<B>;
    inputs: Inputs<B, I>;
  }): Process<Collections, Results<B>>;

  /**
   */
  initialize(options: { inputs: Inputs<B, I> }): Outputs<B, O>;

  /**
   */
  convert(options: { result: Result<B>; inputs: Inputs<B, I>; input: I }): O;

  /**
   */
  merge(options: {
    outputs: Outputs<B, O>;
    breadcrumb: Breadcrumb<B>;
    output: O;
  }): Outputs<B, O>;
};

export type Batch = {
  structure: any;
  breadcrumb: any;
  input: any;
  entry?: any;
  result?: any;
  output: any;
};

type Structure<B extends Batch> = B["structure"];

type Breadcrumb<B extends Batch> = B["breadcrumb"];
type Breadcrumbs<B extends Batch> = {
  [index: number]: Breadcrumb<B>;
};

export type Input<B extends Batch> = B["input"];
export type Inputs<B extends Batch, I extends Input<B>> = $<Structure<B>, [I]>;

type Entry<B extends Batch> = B["entry"];
type Entries<B extends Batch> = Entry<B>[];

export type Output<B extends Batch> = B["output"];
export type Outputs<B extends Batch, O extends Output<B>> = $<
  Structure<B>,
  [O]
>;

type Result<B extends Batch> = B["result"];
type Results<B extends Batch> = Result<B>[];
