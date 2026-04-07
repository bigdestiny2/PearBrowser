import { registerRootComponent } from 'expo'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import React from 'react'
import App from './app/App'

function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  )
}

registerRootComponent(Root)
