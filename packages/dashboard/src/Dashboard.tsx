import WebSocket from "isomorphic-ws";
import {
  DashboardProviderMessage,
  connectToMessageBusWithRetries,
  isDashboardProviderMessage,
  isInvalidateMessage,
  isDebugMessage,
  Message,
  base64ToJson
} from "@truffle/dashboard-message-bus";
import { useEffect, useState } from "react";
import { getPorts, respond } from "./utils/utils";
import Header from "./components/Header/Header";
import DashboardProvider from "./components/DashboardProvider/DashboardProvider";
import ConnectNetwork from "./components/ConnectNetwork";
import ConfirmNetworkChanged from "./components/ConfirmNetworkChange";
import { useNetwork } from "wagmi";

function Dashboard() {
  const [paused, setPaused] = useState<boolean>(false);
  const [connectedChainId, setConnectedChainId] = useState<number>();
  const [socket, setSocket] = useState<WebSocket | undefined>();
  const [dashboardProviderRequests, setDashboardProviderRequests] = useState<
    DashboardProviderMessage[]
  >([]);

  const [{ data }] = useNetwork();
  const chainId = data.chain?.id;

  useEffect(() => {
    if (!chainId || !socket) return;

    if (connectedChainId) {
      if (connectedChainId !== chainId) setPaused(true);
      if (connectedChainId === chainId) setPaused(false);
    } else {
      setConnectedChainId(chainId);
    }
  }, [chainId, connectedChainId, socket]);

  const initializeSocket = async () => {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    const messageBusHost = window.location.hostname;
    const { subscribePort } = await getPorts();
    const connectedSocket = await connectToMessageBusWithRetries(
      subscribePort,
      messageBusHost
    );

    connectedSocket.addEventListener(
      "message",
      (event: WebSocket.MessageEvent) => {
        if (typeof event.data !== "string") {
          event.data = event.data.toString();
        }

        const message = base64ToJson(event.data) as Message;

        console.debug("Received message", message);

        if (isDashboardProviderMessage(message)) {
          setDashboardProviderRequests(previousRequests => [
            ...previousRequests,
            message
          ]);
        } else if (isInvalidateMessage(message)) {
          setDashboardProviderRequests(previousRequests =>
            previousRequests.filter(request => request.id !== message.payload)
          );
        } else if (isDebugMessage(message)) {
          const { payload } = message;
          console.log(payload.message);
          respond({ id: message.id }, connectedSocket);
        }
      }
    );

    connectedSocket.send("ready");

    setSocket(connectedSocket);
  };

  return (
    <div className="h-full min-h-screen bg-gradient-to-b from-truffle-lighter to-truffle-light">
      <Header />
      {paused && chainId && connectedChainId && (
        <ConfirmNetworkChanged
          newChainId={chainId}
          previousChainId={connectedChainId}
          confirm={() => setConnectedChainId(chainId)}
        />
      )}
      {!paused && !socket && <ConnectNetwork confirm={initializeSocket} />}
      {!paused && socket && (
        <DashboardProvider
          paused={paused}
          socket={socket}
          requests={dashboardProviderRequests}
          setRequests={setDashboardProviderRequests}
        />
      )}
    </div>
  );
}

export default Dashboard;
