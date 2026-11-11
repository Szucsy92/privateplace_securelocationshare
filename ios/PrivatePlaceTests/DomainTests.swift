import XCTest
import CryptoKit
@testable import PrivatePlace

final class DomainTests: XCTestCase {
    func testRoomInputParsing() {
        let t = generateRoomToken()
        XCTAssertEqual(t.count, 20)
        XCTAssertEqual(parseRoomInput(formatRoomToken(t.lowercased()))?.token, t)
        let auth = createRoomAuthority()
        let link = buildRoomLink(base: "https://x.test", token: t, name: "Család", color: "rose", ownerKey: auth.ownerKey)
        let inv = parseRoomInput(link)
        XCTAssertEqual(inv?.token, t); XCTAssertEqual(inv?.name, "Család"); XCTAssertEqual(inv?.color, "rose"); XCTAssertEqual(inv?.ownerKey, auth.ownerKey)
        XCTAssertNil(parseRoomInput("nem kód"))
    }
    func testSignedControlRoundTrip() {
        let auth = createRoomAuthority(), t = generateRoomToken()
        let kick = signRoomControl(token: t, auth: auth, kind: "kick", target: "abcdef0123456789")!
        XCTAssertTrue(verifyRoomControl(kick, ownerKey: auth.ownerKey))
        var forged = kick; forged.target = "ffffffffffffffff"
        XCTAssertFalse(verifyRoomControl(forged, ownerKey: auth.ownerKey))
        XCTAssertTrue(verifyRoomControl(parseRoomControl(kick.json)!, ownerKey: auth.ownerKey))
    }
    func testLocationValidation() {
        let now: Int64 = 1_700_000_000_000
        let ok: [String: Any] = ["lat": 47.5, "lng": 19.0, "t": now, "acc": 5, "speed": 1.2]
        if case .ok = parseLocation(ok, now: now) {} else { XCTFail() }
        if case .invalid = parseLocation(["lat": 91, "lng": 19.0, "t": now], now: now) {} else { XCTFail() }
        if case .invalid = parseLocation(["lat": 47.5, "lng": 19.0, "t": now + 600_000], now: now) {} else { XCTFail() }
    }
    func testTransportNeedsHold() {
        var s = TransportState(mode: .walk, candidate: nil, candidateAt: 0)
        s = updateTransport(s, speed: 12, now: 1000); XCTAssertEqual(s.mode, .walk)
        s = updateTransport(s, speed: 12, now: 9000); XCTAssertEqual(s.mode, .car)
    }
    func testStationaryDoesNotDrift() {
        let f = DriftFilter(); var t: Int64 = 1_700_000_000_000; var last: FilteredFix?
        var g = SystemRandomNumberGenerator()
        for _ in 0..<120 { t += 1000
            let dx = Double.random(in: -4...4, using: &g), dy = Double.random(in: -4...4, using: &g)
            last = f.filter(RawFix(lat: 47.5 + dy / 110540, lng: 19.0 + dx / 75000, acc: 8, speed: 0, speedAcc: 0.3, bearing: nil, at: t, src: "gps")) }
        XCTAssertEqual(last?.mode, "still")
    }
    func testWalkingLeavesStill() {
        let f = DriftFilter(); var t: Int64 = 1_700_000_000_000; var lat = 47.5; var last: FilteredFix?
        for _ in 0..<40 { t += 1000; last = f.filter(RawFix(lat: 47.5, lng: 19.0, acc: 6, speed: 0, speedAcc: 0.2, bearing: nil, at: t, src: "gps")) }
        for _ in 0..<25 { t += 1000; lat += 1.4 / 110540; last = f.filter(RawFix(lat: lat, lng: 19.0, acc: 6, speed: 1.4, speedAcc: 0.2, bearing: 0, at: t, src: "gps")) }
        XCTAssertEqual(last?.mode, "moving")
    }
    /// A közös protokoll (téma-hash, AES-GCM) platformok közt azonos: ugyanaz a token → ugyanaz a téma.
    func testRoomCryptoRoundTrip() {
        let c = RoomCrypto(token: "ABCDEFGHJKLMNPQRSTUV")
        XCTAssertEqual(c.topic.count, 64)
        XCTAssertEqual(c.decrypt(c.encrypt("szia")!), "szia")
    }
}
