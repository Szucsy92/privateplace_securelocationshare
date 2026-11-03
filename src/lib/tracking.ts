// src/lib/tracking.ts
import { stationaryDetector, PositionCoordinates } from './stationary';

export interface TrackingCallback {
  (position: PositionCoordinates, isStationary: boolean): void;
}

// Belső útvonal-történet a MapApp és PeerNetwork számára
let trackHistory: PositionCoordinates[] = [];

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
        
        // Automatikusan mentjük a történetbe is
        appendTrackPoint(smoothedPosition);

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

// Kompatibilitás a MapApp és usePeerNetwork által elvárt függvényekkel
export function appendTrackPoint(position: PositionCoordinates): void {
  if (!position) return;
  trackHistory.push(position);
  if (trackHistory.length > 500) {
    trackHistory.shift(); // Ne nőjön végtelenre a memória
  }
}

export function clearTrackHistory(): void {
  trackHistory = [];
}

export function shouldPublishLocation(newPos: PositionCoordinates, lastPublishedPos: PositionCoordinates | null): boolean {
  if (!lastPublishedPos) return true;
  // Ha 3 méternél többet mozdult, küldjük frissítésként a peer hálózatnak
  const R = 6371e3;
  const dLat = (newPos.latitude - lastPublishedPos.latitude) * (Math.PI / 180);
  const dLon = (newPos.longitude - lastPublishedPos.longitude) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lastPublishedPos.latitude * (Math.PI / 180)) * Math.cos(newPos.latitude * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance > 3.0;
}
