import { useState, useEffect } from "react";
import { ProjectDecoder, forProject } from "@truffle/decoder";
import type { Db, Resources } from "@truffle/db";
import TruffleConfig from "@truffle/config";

import { useCompilations, Status } from "./useCompilations";
import { prepareProjectInfo } from "@truffle/db-kit/utils";

export interface UseDecoderOptions {
  config: TruffleConfig;
  db: Db;
  project: Resources.IdObject<"projects">;
  network: Pick<Resources.Input<"networks">, "name">;
  addresses: string[];
}

export interface DecoderInfo {
  decoder: ProjectDecoder | undefined;
  statusByAddress: {
    [address: string]: Status;
  };
}

export function useDecoder(options: UseDecoderOptions): DecoderInfo {
  const [decoder, setDecoder] = useState<ProjectDecoder | undefined>();
  const { done, compilations, statusByAddress } = useCompilations(options);

  useEffect(() => {
    if (compilations) {
      prepareProjectInfo({ compilations })
        .then(projectInfo =>
          forProject({ provider: options.config.provider, projectInfo })
        )
        .then(setDecoder);
    }
  }, [done]);

  return { decoder, statusByAddress };
}
