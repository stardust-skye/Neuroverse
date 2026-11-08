import { Component, type ReactNode } from 'react'
import Device3D from './Device3D'

// If WebGL is unavailable the 3D view must never take the rest of the app down.
class Boundary extends Component<{ children: ReactNode; height: number }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="device-fallback" style={{ height: this.props.height }}>
        <span>3D preview needs WebGL</span>
      </div>
    )
  }
}

export default function SafeDevice(props: { signal?: Record<string, number>; height?: number }) {
  const height = props.height ?? 320
  return <Boundary height={height}><Device3D {...props} height={height} /></Boundary>
}
