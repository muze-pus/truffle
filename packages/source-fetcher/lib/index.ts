import type { Fetcher, FetcherConstructor } from "./types";
import { InvalidNetworkError } from "./common";
export { Fetcher, FetcherConstructor, InvalidNetworkError };

import EtherscanFetcher from "./etherscan";
import SourcifyFetcher from "./sourcify";

const Fetchers: FetcherConstructor[] = [EtherscanFetcher, SourcifyFetcher];

export default Fetchers;
