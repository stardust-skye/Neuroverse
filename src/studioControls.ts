export function shouldStartSpaceDrawing(
  code: string,
  alreadyHeld: boolean,
  editableTarget: boolean,
): boolean {
  return code === 'Space' && !alreadyHeld && !editableTarget
}

export function shouldStopSpaceDrawing(code: string, alreadyHeld: boolean): boolean {
  return code === 'Space' && alreadyHeld
}

export function shouldPauseForLostFace(
  drawing: boolean,
  cameraActive: boolean,
  faceDetected: boolean,
): boolean {
  return drawing && cameraActive && !faceDetected
}

export function canCompleteChallenge(coverage: number): boolean {
  return Number.isFinite(coverage) && coverage >= 0.7
}
