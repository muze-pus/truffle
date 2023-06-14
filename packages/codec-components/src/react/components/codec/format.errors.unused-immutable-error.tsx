import React from "react";
import type { Format } from "@truffle/codec";
import { createCodecComponent } from "../../utils/create-codec-component";
import { CodecError } from "../common/codec-error";

export const { UnusedImmutableError } = createCodecComponent(
  "UnusedImmutableError",
  ({ kind }: Format.Errors.UnusedImmutableError) => <CodecError kind={kind} />
);
