package com.pearbrowser.app.rpc;

import com.pearbrowser.app.rpc.IPearRpcCallback;

interface IPearRpcService {
    void request(int command, String dataJson, IPearRpcCallback callback);
    boolean isBackendAvailable();
}
