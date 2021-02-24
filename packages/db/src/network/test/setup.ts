import { logger } from "@truffle/db/logger";
const debug = logger("db:network:test:setup");

import { connect } from "@truffle/db";

export const setup = async (options: { identifier: string }) => {
  const db = connect({
    adapter: {
      name: "memory",
    }
  });

  return db;
};
