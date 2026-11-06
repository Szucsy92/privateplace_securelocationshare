// src/lib/stationary.ts

export interface RawGPSFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  speedAccuracy?: number | null;
  heading: number | null;
  timestamp: number;
}

export interface FilteredFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  state: 'acquiring' | 'stationary' | 'moving';
  isReliable: boolean;
}

export type TrackingState = 'acquiring' | 'stationary' | 'moving';

export interface StationaryFilterConfig {
  minAcquireCount: number;
  minAcquireWindowMs: number;
  maxAllowedAccuracy: number;
  noiseThreshold: number;
  heightenedThreshold: number;
  clusterThreshold: number;
  dopplerSpeedThreshold: number;
}

const DEFAULT_CONFIG: StationaryFilterConfig = {
  minAcquireCount: 5,
  minAcquireWindowMs: 12000,
  maxAllowedAccuracy: 30,
  noiseThreshold: 4,
  heightenedThreshold: 10,
  clusterThreshold: 20,
  dopplerSpeedThreshold: 2.5,
};

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeMedianCoordinate(fixes: RawGPSFix[]): { latitude: number; longitude: number; accuracy: number } {
  if (fixes.length === 0) return { latitude: 0, longitude: 0, accuracy: 999 };
  
  const lats = fixes.map(f => f.latitude).sort((a, b) => a - b);
  const lons = fixes.map(f => f.longitude).sort((a, b) => a - b);
  const accs = fixes.map(f => f.accuracy).sort((a, b) => a - b);

  const mid = Math.floor(fixes.length / 2);
  const lat = fixes.length % 2 !== 0 ? lats[mid] : (lats[mid - 1] + lats[mid]) / 2;
  const lon = fixes.length % 2 !== 0 ? lons[mid] : (lons[mid - 1] + lons[mid]) / 2;
  const acc = fixes.length % 2 !== 0 ? accs[mid] : (accs[mid - 1] + accs[mid]) / 2;

  return { latitude: lat, longitude: lon, accuracy: acc };
}

class SimpleKalmanFilter {
  private estimateLat: number;
  private estimateLon: number;
  private variance: number;

  constructor(initialLat: number, initialLon: number, initialAccuracy: number) {
    this.estimateLat = initialLat;
    this.estimateLon = initialLon;
    this.variance = initialAccuracy * initialAccuracy;
  }

  public update(lat: number, lon: number, accuracy: number): { latitude: number; longitude: number } {
    const measurementVariance = accuracy * accuracy;
    const kalmanGain = this.variance / (this.variance + measurementVariance);

    this.estimateLat = this.estimateLat + kalmanGain * (lat - this.estimateLat);
    this.estimateLon = this.estimateLon + kalmanGain * (lon - this.estimateLon);
    this.variance = (1 - kalmanGain) * this.variance;

    return { latitude: this.estimateLat, longitude: this.estimateLon };
  }

  public reset(lat: number, lon: number, accuracy: number) {
    this.estimateLat = lat;
    this.estimateLon = lon;
    this.variance = accuracy * accuracy;
  }
}

export class StationaryGPSFilterV3 {
  private config: StationaryFilterConfig;
  private state: TrackingState = 'acquiring';
  private acquireBuffer: RawGPSFix[] = [];
  private anchor: { latitude: number; longitude: number } | null = null;
  private candidate: { latitude: number; longitude: number; count: number; firstSeen: number } | null = null;
  private shown: { latitude: number; longitude: number; accuracy: number } | null = null;
  private kalmanFilter: SimpleKalmanFilter | null = null;
  private lastValidFix: RawGPSFix | null = null;

  constructor(config: Partial<StationaryFilterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public reset(): void {
    this.state = 'acquiring';
    this.acquireBuffer = [];
    this.anchor = null;
    this.candidate = null;
    this.shown = null;
    this.kalmanFilter = null;
    this.lastValidFix = null;
  }

  public processFix(fix: RawGPSFix, isStepping: boolean = false): FilteredFix {
    if (fix.accuracy > this.config.maxAllowedAccuracy) {
      if (this.shown) {
        return { ...this.shown, state: this.state, isReliable: false };
      }
      return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, state: this.state, isReliable: false };
    }

    const now = fix.timestamp;
    const speed = fix.speed ?? 0;
    const isMovingFast = speed >= this.config.dopplerSpeedThreshold;

    switch (this.state) {
      case 'acquiring': {
        if (this.acquireBuffer.length > 0) {
          const firstTimestamp = this.acquireBuffer[0].timestamp;
          if (now - firstTimestamp > this.config.minAcquireWindowMs * 2) {
            this.acquireBuffer = this.acquireBuffer.filter(f => now - f.timestamp <= this.config.minAcquireWindowMs);
          }
        }

        this.acquireBuffer.push(fix);

        const timeSpan = this.acquireBuffer.length > 1 
          ? this.acquireBuffer[this.acquireBuffer.length - 1].timestamp - this.acquireBuffer[0].timestamp 
          : 0;

        if (isMovingFast || isStepping || this.acquireBuffer.length >= this.config.minAcquireCount) {
          const medianFix = computeMedianCoordinate(this.acquireBuffer);
          if (medianFix.accuracy <= this.config.maxAllowedAccuracy) {
            this.anchor = { latitude: medianFix.latitude, longitude: medianFix.longitude };
            this.shown = { latitude: medianFix.latitude, longitude: medianFix.longitude, accuracy: medianFix.accuracy };
            
            if (!this.kalmanFilter) {
              this.kalmanFilter = new SimpleKalmanFilter(medianFix.latitude, medianFix.longitude, medianFix.accuracy);
            } else {
              this.kalmanFilter.reset(medianFix.latitude, medianFix.longitude, medianFix.accuracy);
            }

            this.state = (isMovingFast || isStepping) ? 'moving' : 'stationary';
          }
        }

        if (!this.shown) {
          return {
            latitude: fix.latitude,
            longitude: fix.longitude,
            accuracy: fix.accuracy,
            state: 'acquiring',
            isReliable: false,
          };
        }
        break;
      }

      case 'stationary': {
        if (!this.anchor) {
          this.state = 'acquiring';
          return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, state: 'acquiring', isReliable: false };
        }

        if (speed > 1.2 || isStepping || isMovingFast) {
          this.state = 'moving';
          this.candidate = null;
          break;
        }

        const distanceToAnchor = calculateDistance(
          this.anchor.latitude,
          this.anchor.longitude,
          fix.latitude,
          fix.longitude
        );

        if (distanceToAnchor > this.config.heightenedThreshold && distanceToAnchor <= this.config.clusterThreshold) {
          if (!this.candidate) {
            this.candidate = { latitude: fix.latitude, longitude: fix.longitude, count: 1, firstSeen: now };
          } else {
            const distToCandidate = calculateDistance(this.candidate.latitude, this.candidate.longitude, fix.latitude, fix.longitude);
            if (distToCandidate < 3) {
              this.candidate.count++;
              if (this.candidate.count >= 3 && now - this.candidate.firstSeen >= 4000) {
                this.anchor = { latitude: this.candidate.latitude, longitude: this.candidate.longitude };
                this.shown = { latitude: this.candidate.latitude, longitude: this.candidate.longitude, accuracy: fix.accuracy };
                if (this.kalmanFilter) {
                  this.kalmanFilter.reset(this.anchor.latitude, this.anchor.longitude, fix.accuracy);
                }
                this.candidate = null;
              }
            } else {
              this.candidate = { latitude: fix.latitude, longitude: fix.longitude, count: 1, firstSeen: now };
            }
          }
        }
        break;
      }

      case 'moving': {
        if (speed < 0.6 && !isStepping && !isMovingFast) {
          this.state = 'stationary';
          this.anchor = { latitude: fix.latitude, longitude: fix.longitude };
          this.candidate = null;
        }

        if (this.kalmanFilter) {
          const smoothed = this.kalmanFilter.update(fix.latitude, fix.longitude, fix.accuracy);
          this.shown = { latitude: smoothed.latitude, longitude: smoothed.longitude, accuracy: fix.accuracy };
        } else {
          this.shown = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy };
          this.kalmanFilter = new SimpleKalmanFilter(fix.latitude, fix.longitude, fix.accuracy);
        }
        break;
      }
    }

    this.lastValidFix = fix;
    return {
      ...(this.shown || { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }),
      state: this.state,
      isReliable: this.state !== 'acquiring',
    };
  }

  public getState(): TrackingState {
    return this.state;
  }
}

// Visszafelé kompatibilis alapértelmezett export vagy wrapper, ha a többi modul ezt igényli
export function filterStationaryFix(fix: RawGPSFix, isStepping: boolean = false): FilteredFix {
  // Egyszerű stateless hívásokhoz vagy globális instance-hoz
  return filterInstance.processFix(fix, isStepping);
}

const filterInstance = new StationaryGPSFilterV3();
