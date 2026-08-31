type NetInfoState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

const defaultExport = {
  addEventListener: (_listener: (state: NetInfoState) => void) => () => undefined,
};

export default defaultExport;
