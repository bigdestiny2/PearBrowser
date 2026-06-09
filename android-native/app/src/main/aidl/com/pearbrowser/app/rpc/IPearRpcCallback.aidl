package com.pearbrowser.app.rpc;

interface IPearRpcCallback {
    void onSuccess(String resultJson);
    void onError(String message);
}
