// src/lib/tracking.ts
import { stationaryDetector, PositionCoordinates } from './stationary';

export interface TrackingCallback {
  (position: PositionCoordinates, isStationary: boolean): void;
}

class GPSWalkerTracker {
  private watchId: number | null = null;
  private lastProcessedPos: PositionCoordinates | null = null;

  public startTracking(onPositionUpdate: TrackingCallback, onError?: (error: GeolocationPositionError) => void) {
    if (!navigator.geolocation) {
      console.error('A böngésző nem támogatja a helymeghatározást.');
      return;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    };

    this.watchId = navigator.geolocation.watchPosition(
      (pos: GeolocationPosition) => {
        const rawCoords: PositionCoordinates = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };

        const { position: filteredPosition, isStationary } = stationaryDetector.processPosition(rawCoords);
        const smoothedPosition = this.applySmoothing(filteredPosition, isStationary);

        this.lastProcessedPos = smoothedPosition;
        onPositionUpdate(smoothedPosition, isStationary);
      },
      (err) => {
        if (onError) onError(err);
      },
      options
    );
  }

  public stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private applySmoothing(newPos: PositionCoordinates, isStationary: boolean): PositionCoordinates {
    if (isStationary || !this.lastProcessedPos) {
      return newPos;
    }

    const alpha = 0.7; 
    const smoothedLat = alpha * newPos.latitude + (1 - alpha) * this.lastProcessedPos.latitude;
    const smoothedLon = alpha * newPos.longitude + (1 - alpha) * this.lastProcessedPos.longitude;

    return {
      ...newPos,
      latitude: smoothedLat,
      longitude: smoothedLon,
    };
  }
}

export const gpsTracker = new GPSWalkerTracker();

// Kompatibilitás a MapApp.tsx és usePeerNetwork.ts által elvárt exportokkal:
export function appendTrackPoint(...args: any[]): void {}
export function clearTrackHistory(...args: any[]): void {}
export function shouldPublishLocation(...args: any[]): boolean { return true; }
