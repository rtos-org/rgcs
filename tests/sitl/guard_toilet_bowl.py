#!/usr/bin/env python3
"""AI 緊急介入: toilet-bowl scenarios on a SCRATCH SITL.

python3 stdlib only. Drives a scratch rgcs-server (login, guard level, modes, arm / takeoff,
alerts, audit) and the scratch SITL directly:
  * RC input: 16 x uint16 UDP packets at 50 Hz to SITL's RC port (ch1-4 centred; throttle low
    on the ground). A stick move is a ch1 change for 1 s.
  * Fault set-up: PARAM_SET / reboot over the SITL's second MAVLink port (SERIAL1, tcp:<sitl>+2).
    The server refuses parameter writes while armed and has no reboot, so the
    fault goes straight to the scratch SITL, never through any server.

Refuses to run against the dev stack: server port 8000, SITL / MAVLink ports 5760-5793, RC
ports 5501-5531, 14550 / 14551.

  python3 -I tests/sitl/guard_toilet_bowl.py --server http://127.0.0.1:8110 \\
      --sitl-port 5820 --rc-port 5561 --scenarios A,B --out report.json

Scenarios: A steady wind in LOITER (expect 0 alerts); B bowl + L2 + RC takeover;
C bowl + L2 + cancel (the UI via --ui-cancel-flag, else the cancel API); D bowl + L3 and no RC
change -> unanswered, exactly one guard set_mode in the audit.

Two kinds of bowl (--bowl):
  compass (default): the real fault, as ArduPilot's own autotest makes it: a mis-oriented compass
    (COMPASS_ORIENT, default 2 = yaw 90, plus a hard-iron offset worth about --extra-deg 40) set
    on the ground followed by a SITL reboot, so the EKF aligns its yaw to the wrong compass; one
    compass in use, no GSF emergency yaw reset, EKF failsafe off and only the compass pre-arm
    check skipped, so that the FC's own LAND does not pre-empt the guard under test. A fault
    injected in flight (SIM_MAG1_OFS step or ramp, COMPASS_ORIENT) is rejected or corrected by
    EKF3 and gives no bowl, so the bowl starts on entering LOITER / QLOITER. On EKF3 the SITL
    bowl decays (~90 deg) or turns into a run-away with position resets (~135 deg).
  wind: a pipeline check that is the same every run: weak loiter (LOIT_ANG_MAX 5) in a wind
    that turns 30 deg/s and strengthens, so the vehicle drifts on a growing circle with its nose
    held (signs A + B).
"""
import argparse
import http.cookiejar
import json
import math
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

DEV_SITL = range(5760, 5794)
DEV_RC = range(5501, 5532)
DEV_OTHER = {8000, 5173, 14550, 14551, 37260}
PREFLIGHT = {'EK3_GSF_USE_MASK': 0.0, 'COMPASS_USE2': 0.0, 'COMPASS_USE3': 0.0, 'FS_EKF_THRESH': 0.0,
             'EK3_MAG_CAL': 2.0, 'ARMING_SKIPCHK': 4.0}  # skip only the compass pre-arm check
H_MG = 300.0  # horizontal field at Kamikochi, mGauss (WMM ~30 500 nT)
DECL = -8.0  # declination there, degrees


def hard_iron(true_yaw, deg, orient_deg=0.0):
    """SIM_MAG1_OFS_X / _Y (sensor frame) that turn the compass heading by about `deg` at the
    vehicle's true yaw, for a sensor mounted rotated by `orient_deg` (yaw) on the body."""
    a = math.radians(true_yaw - DECL)
    b = math.radians(true_yaw - DECL + deg)
    bx, by = H_MG * (math.cos(b) - math.cos(a)), -H_MG * (math.sin(b) - math.sin(a))
    r = math.radians(-orient_deg)  # body -> sensor
    return {'SIM_MAG1_OFS_X': round(bx * math.cos(r) - by * math.sin(r), 1),
            'SIM_MAG1_OFS_Y': round(bx * math.sin(r) + by * math.cos(r), 1)}


def refuse_dev_stack(a):
    port = urlparse(a.server).port or 80
    bad = [port in DEV_OTHER, a.sitl_port in DEV_SITL, a.sitl_port + 2 in DEV_SITL,
           a.rc_port in DEV_RC or a.rc_port in DEV_OTHER]
    if any(bad):
        sys.exit('refusing: these ports belong to the dev stack; use the scratch server / SITL')


# ---------------------------------------------------------------- MAVLink v1 out, v1 / v2 in

def x25(data, crc=0xFFFF):
    for b in data:
        tmp = b ^ (crc & 0xFF)
        tmp = (tmp ^ (tmp << 4)) & 0xFF
        crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
    return crc


class Mav:
    """A minimal MAVLink client on the scratch SITL's SERIAL1: PARAM_SET / PARAM_REQUEST_READ /
    COMMAND_LONG out; PARAM_VALUE and SIMSTATE (true yaw) in."""

    def __init__(self, port):
        self.port = port
        self.seq = 0
        self.values = {}
        self.true_yaw = None
        self.lock = threading.Lock()
        self.send_lock = threading.Lock()
        self.sock = None
        self.connect()

    def connect(self, timeout=60):
        end = time.time() + timeout
        while True:
            try:
                self.sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
                break
            except OSError:
                if time.time() > end:
                    raise
                time.sleep(1)
        threading.Thread(target=self._reader, args=(self.sock,), daemon=True).start()
        self.ask_simstate()

    def _send(self, msgid, crc_extra, payload):
        with self.send_lock:
            hdr = bytes([len(payload), self.seq & 0xFF, 255, 190, msgid])
            self.seq += 1
            crc = x25(bytes([crc_extra]), x25(hdr + payload))
            self.sock.sendall(b'\xfe' + hdr + payload + struct.pack('<H', crc))

    def _reader(self, sock):
        buf = b''
        while True:
            try:
                chunk = sock.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buf = self._parse(buf + chunk)

    def _parse(self, buf):
        while len(buf) >= 8:
            if buf[0] == 0xFE:
                n, msgid, start, total = buf[1], buf[5], 6, buf[1] + 8
            elif buf[0] == 0xFD:
                n = buf[1]
                msgid = buf[7] | buf[8] << 8 | buf[9] << 16
                start, total = 10, n + 12 + (13 if buf[2] & 1 else 0)
            else:
                buf = buf[1:]
                continue
            if len(buf) < total:
                return buf
            self._handle(msgid, buf[start:start + n])
            buf = buf[total:]
        return buf

    def _handle(self, msgid, p):
        if msgid == 22:  # PARAM_VALUE
            p = p.ljust(25, b'\0')
            name = p[8:24].split(b'\0')[0].decode('ascii', 'replace')
            with self.lock:
                self.values = {**self.values, name: struct.unpack('<f', p[0:4])[0]}
        elif msgid == 164:  # SIMSTATE: the simulator's true attitude
            self.true_yaw = math.degrees(struct.unpack('<f', p.ljust(12, b'\0')[8:12])[0]) % 360

    def _wait(self, name, want=None, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                v = self.values.get(name)
            if v is not None and (want is None or abs(v - want) < 1e-3):
                return v
            time.sleep(0.05)
        return None

    def command(self, cmd, *params):
        args = (list(params) + [0.0] * 7)[:7]
        self._send(76, 152, struct.pack('<7fHBBB', *args, cmd, 1, 1, 0))

    def ask_simstate(self, hz=2):
        self.command(511, 164, 1e6 / hz)  # MAV_CMD_SET_MESSAGE_INTERVAL

    def reboot(self):
        """MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN; SITL restarts in place, then reconnect."""
        self.command(246, 1)
        time.sleep(3)
        self.sock.close()
        self.connect()

    def get(self, name):
        with self.lock:
            self.values = {k: v for k, v in self.values.items() if k != name}
        self._send(20, 214, struct.pack('<hBB', -1, 1, 1) + name.encode('ascii').ljust(16, b'\0'))
        return self._wait(name)

    def set(self, name, value):
        pid = name.encode('ascii').ljust(16, b'\0')
        self._send(23, 168, struct.pack('<fBB', value, 1, 1) + pid + bytes([9]))
        if self._wait(name, value) is None:
            raise RuntimeError(f'{name} = {value} not confirmed by the scratch SITL')


# ---------------------------------------------------------------- RC feeder

class Rc:
    def __init__(self, port):
        self.addr = ('127.0.0.1', port)
        # ch5 (FLTMODE_CH) and up stay low and never change, so no mode switch fires.
        self.chans = (1500, 1500, 1000, 1500) + (1000,) * 12
        self.stop = threading.Event()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        threading.Thread(target=self._loop, daemon=True).start()

    def set(self, **kw):  # ch1=…, ch3=…
        c = list(self.chans)
        for k, v in kw.items():
            c[int(k[2:]) - 1] = v
        self.chans = tuple(c)

    def _loop(self):
        while not self.stop.is_set():
            self.sock.sendto(struct.pack('<16H', *self.chans), self.addr)
            time.sleep(0.02)


# ---------------------------------------------------------------- scratch server API

class Api:
    def __init__(self, base):
        self.base = base.rstrip('/')
        jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header('X-Requested-With', 'rgcs')
        req.add_header('content-type', 'application/json')
        try:
            with self.op.open(req, timeout=10) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            return json.loads(e.read() or b'{}')

    def data(self, method, path, body=None):
        r = self.call(method, path, body)
        if not r.get('success'):
            raise RuntimeError(f'{method} {path}: {r.get("error")}')
        return r['data']

    def vehicle(self):
        return self.data('GET', '/api/vehicles/1')

    def command(self, cmd, args=None, confirm=False):
        body = {'cmd': cmd, **({'args': args} if args is not None else {})}
        if confirm:
            body['confirm_token'] = self.data('POST', '/api/vehicles/1/confirm', {'cmd': cmd})['confirm_token']
        return self.call('POST', '/api/vehicles/1/command', body)


# ---------------------------------------------------------------- vehicle handling

class Flight:
    """Polling, modes, faults, takeoff and landing on the scratch vehicle."""

    def __init__(self, a):
        self.a = a
        self.api = Api(a.server)
        self.api.data('POST', '/api/auth/login', {'username': 'admin', 'password': 'admin'})
        self.rc = Rc(a.rc_port)
        time.sleep(2)  # let SITL take the RC frames before any mode change
        self.mav = Mav(a.sitl_port + 2)
        self.t0 = time.time()
        self.events = []
        self.seen = {}
        self.faulty = None  # unknown until set
        self.copter = self.api.vehicle()['kind'] == 'copter'
        self.hover = 'LOITER' if self.copter else 'QLOITER'
        self.action = 'ALT_HOLD' if self.copter else 'QHOVER'
        self.loit_ang = 'LOIT_ANG_MAX' if self.copter else 'Q_LOIT_ANG_MAX'

    def log(self, what, **kw):
        e = {'t': round(time.time() - self.t0, 2), 'what': what, **kw}
        self.events.append(e)
        print(json.dumps(e, ensure_ascii=False), flush=True)

    def poll(self):
        """One look at the alerts and the vehicle; logs every new (alert, phase)."""
        alerts = self.api.data('GET', '/api/guard/alerts')
        for al in alerts:
            if (al['id'], al['phase']) not in self.seen:
                self.seen[(al['id'], al['phase'])] = time.time()
                self.log('alert', id=al['id'], phase=al['phase'], level=al['level'], signs=al.get('signs'),
                         kp_raised=al.get('kp_raised'), rc_stale=al.get('rc_stale'), mode=al.get('action_mode'))
        return alerts, self.api.vehicle()

    def watch(self, secs, until=None):
        """Poll at 4 Hz for `secs`; with `until`, returns (alerts, vehicle) once it holds, else None."""
        end = time.time() + secs
        alerts, v = self.poll()
        while time.time() < end:
            if until and until(alerts, v):
                return alerts, v
            time.sleep(0.25)
            alerts, v = self.poll()
        return (alerts, v) if until is None else None

    def level(self, lv):
        self.api.data('PUT', '/api/guard/settings', {'toilet_bowl': lv})
        self.log('level', level=lv)

    def mode(self, m):
        r = self.api.command('set_mode', {'mode': m})
        self.log('set_mode', mode=m, ok=r.get('success'))
        if not self.watch(10, lambda al, v: v['mode'] == m):
            raise RuntimeError(f'mode {m} not reached')

    def params(self, values, optional=()):
        """PARAM_SET each value on the scratch SITL; names in `optional` may be absent (airframe)."""
        done = {}
        for k, v in values.items():
            if self.mav.get(k) is None:
                if k in optional:
                    continue
                raise RuntimeError(f'unknown parameter {k} on the scratch SITL')
            self.mav.set(k, v)
            done = {**done, k: v}
        self.log('params', **done)

    def set_fault(self, on):
        """Mis-orient the compass (or restore it) on the ground and reboot the scratch SITL."""
        if on == self.faulty:
            return
        for _ in range(30):
            if self.mav.true_yaw is not None:
                break
            time.sleep(0.1)
        yaw = self.mav.true_yaw if self.mav.true_yaw is not None else 0.0
        # the orientation fault reads yaw low (EKF − true < 0); the hard iron adds to that error
        extra = hard_iron(yaw, -self.a.extra_deg if on else 0.0, 45.0 * self.a.orient if on else 0.0)
        self.params({**PREFLIGHT, 'COMPASS_ORIENT': float(self.a.orient if on else 0), **extra},
                    optional=('FS_EKF_THRESH',))
        self.mav.reboot()
        self.faulty = on
        self.log('sitl_rebooted', fault=on)
        if not self.watch(90, lambda al, v: v['link'] == 'ok' and v['gps']['fix'] >= 3):
            raise RuntimeError('scratch SITL did not come back')
        time.sleep(20)  # EKF settles / aligns to the (faulty) compass
        self.log_yaw_error()

    def log_yaw_error(self):
        hdg, true = self.api.vehicle()['hdg'], self.mav.true_yaw
        err = None if hdg is None or true is None else round((hdg - true + 180) % 360 - 180, 1)
        self.log('yaw_error', ekf_hdg=hdg, true_yaw=None if true is None else round(true, 1), err_deg=err)

    def takeoff(self, alt=20.0):
        self.rc.set(ch3=1000)
        self.mode('GUIDED')
        for _ in range(45):
            if self.api.vehicle()['armed'] or (self.api.command('arm', confirm=True).get('success')
                                               and self.watch(5, lambda al, v: v['armed'])):
                break
            time.sleep(2)
        else:
            raise RuntimeError('could not arm')
        self.api.command('takeoff', {'alt_rel': alt}, confirm=True)
        if not self.watch(60, lambda al, v: v['alt_rel'] > alt - 1.5):
            raise RuntimeError('takeoff did not reach altitude')
        self.log('airborne', alt=self.api.vehicle()['alt_rel'])
        self.rc.set(ch3=1500)

    def land(self):
        self.stop_wind_spiral()
        self.rc.set(ch1=1500)
        self.mode('LAND' if self.copter else 'QLAND')
        if not self.watch(120, lambda al, v: not v['armed'] or v['alt_rel'] < 0.3):
            raise RuntimeError('did not land')
        if not self.watch(15, lambda al, v: not v['armed']):
            # on the ground but the land detector is confused by the bad yaw: force-disarm the
            # scratch SITL directly (MAV_CMD_COMPONENT_ARM_DISARM, 21196)
            self.mav.command(400, 0, 21196)
            self.log('force_disarm')
            if not self.watch(10, lambda al, v: not v['armed']):
                raise RuntimeError('did not disarm')
        self.rc.set(ch3=1000)
        self.log('disarmed')
        time.sleep(3)

    def first(self, phase, since):
        return min((t for (_, p), t in self.seen.items() if p == phase and t >= since), default=None)

    def rel(self, t, base):
        return None if t is None or base is None else round(t - base, 2)


# ---------------------------------------------------------------- scenarios

class Scenarios(Flight):
    def scenario_a(self):
        self.set_fault(False)
        self.level('l1')
        self.params({'SIM_WIND_SPD': 8.0, 'SIM_WIND_DIR': 90.0})
        self.takeoff()
        self.mode(self.hover)
        start = time.time()
        self.log('A_start')
        self.watch(self.a.wind_secs)
        n = len({i for (i, p), t in self.seen.items() if t >= start})
        self.params({'SIM_WIND_SPD': 0.0})
        self.land()
        return {'alerts': n, 'pass': n == 0, 'secs': self.a.wind_secs}

    def faulty_hover(self, level):
        """Fault on, take off, enter the hover mode: returns the time the bowl may start."""
        self.set_fault(self.a.bowl == 'compass')
        self.level(level)
        self.takeoff()
        self.log_yaw_error()
        self.mode(self.hover)
        self.log('hover_entered')
        if self.a.bowl == 'wind':
            self.start_wind_spiral()
        return time.time()

    def start_wind_spiral(self):
        """Pipeline check: a weak loiter (LOIT_ANG_MAX) in a wind whose direction turns 30 deg/s
        and whose speed grows drifts the vehicle on a growing circle while the nose stays put
        (signs A + B), deterministically, unlike the SITL compass faults."""
        self.params({self.loit_ang: 5.0, 'Q_WVANE_ENABLE': 0.0}, optional=('Q_WVANE_ENABLE',))
        stop = threading.Event()
        self.spiral = stop
        a = self.a
        t0 = time.time()

        def run():
            while not stop.is_set():
                dt = time.time() - t0
                self.mav.set('SIM_WIND_DIR', round((dt * 30.0) % 360, 1))
                self.mav.set('SIM_WIND_SPD', round(min(a.wind_max, a.wind_start + dt * a.wind_rate), 2))
                time.sleep(0.25)
        threading.Thread(target=run, daemon=True).start()
        self.log('wind_spiral_started')

    def stop_wind_spiral(self):
        if getattr(self, 'spiral', None) is None:
            return
        self.spiral.set()
        self.spiral = None
        time.sleep(0.5)
        self.params({'SIM_WIND_SPD': 0.0, self.loit_ang: 0.0})
        self.log('wind_spiral_stopped')

    def wait_alert(self, timeout=90):
        got = self.watch(timeout, lambda al, v: any(x['phase'] != 'cleared' for x in al))
        return None if not got else next(x for x in got[0] if x['phase'] != 'cleared')

    def summary(self, t0):
        t_alert = min((t for (_, p), t in self.seen.items() if t >= t0), default=None)
        t_cd = self.first('countdown', t0)
        return {'hover_to_alert_s': self.rel(t_alert, t0), 'hover_to_countdown_s': self.rel(t_cd, t0),
                'action_mode': self.action}

    def no_alert(self):
        self.land()
        return {'pass': False, 'why': 'no alert within 90 s of entering the hover mode'}

    def scenario_b(self):
        t0 = self.faulty_hover('l2')
        if self.wait_alert() is None:
            return self.no_alert()
        cd_s = self.api.data('GET', '/api/guard/settings')['countdown_s']
        got = self.watch(cd_s + 3, lambda al, v: v['mode'] == self.action)
        t_mode = time.time() if got else None
        self.log('mode_seen', mode=self.api.vehicle()['mode'],
                 phases=sorted({x['phase'] for x in self.api.data('GET', '/api/guard/alerts')}))
        time.sleep(1.0)
        t_rc = time.time()
        self.rc.set(ch1=1600)
        self.log('rc_move', ch1=1600)
        took = self.watch(5, lambda al, v: any(x['phase'] == 'taken_over' for x in al))
        t_took = self.first('taken_over', t0)
        time.sleep(max(0.0, 1.0 - (time.time() - t_rc)))
        self.rc.set(ch1=1500)
        res = {**self.summary(t0), 'countdown_to_mode_s': self.rel(t_mode, self.first('countdown', t0)),
               'rc_to_taken_over_s': self.rel(t_took, t_rc)}
        res['executed'] = bool(t_mode)
        res['pass'] = bool(took and t_mode) and res['rc_to_taken_over_s'] <= 1.5
        self.land()
        return res

    def scenario_c(self):
        flag = self.a.ui_cancel_flag
        t0 = self.faulty_hover('l2')
        if flag:
            open(flag, 'w').close()
        alert = self.wait_alert()
        if alert is None:
            return self.no_alert()
        if not flag:
            self.api.call('POST', f'/api/guard/alerts/{alert["id"]}/cancel')
        cancelled = self.watch(10, lambda al, v: any(x['phase'] == 'cancelled' for x in al))
        modes = [self.watch(0.5)[1]['mode'] for _ in range(30)]  # ~15 s after the cancel
        res = {**self.summary(t0), 'cancelled': bool(cancelled), 'modes_after': sorted(set(modes)),
               'kp_raised': alert.get('kp_raised'), 'cancel_by': 'ui' if flag else 'api'}
        res['pass'] = bool(cancelled) and set(modes) == {self.hover}
        self.land()
        return res

    def scenario_d(self):
        t0 = self.faulty_hover('l3')
        if self.wait_alert() is None:
            return self.no_alert()
        got = self.watch(5, lambda al, v: v['mode'] == self.action)
        un = self.watch(40, lambda al, v: any(x['phase'] == 'unanswered' for x in al))
        self.watch(5)
        audit = self.api.data('GET', '/api/history/audit?limit=200')
        sets = [r for r in audit if r['target'] == 'ai_intervention' and r['command'] == 'set_mode'
                and r['operator'] == 'ai-guard' and r['ts'] >= iso(t0)]
        res = {**self.summary(t0), 'mode_reached': bool(got), 'unanswered': bool(un),
               'executed_to_unanswered_s': self.rel(self.first('unanswered', t0), self.first('executed', t0)),
               'guard_set_mode_rows': len(sets)}
        res['pass'] = bool(got and un) and len(sets) == 1
        self.land()
        return res


def iso(t):
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--server', required=True)
    p.add_argument('--sitl-port', type=int, required=True)
    p.add_argument('--rc-port', type=int, required=True)
    p.add_argument('--scenarios', default='A,B,C,D')
    p.add_argument('--wind-secs', type=int, default=60)
    p.add_argument('--orient', type=int, default=2, help='COMPASS_ORIENT for the fault (2 = yaw 90)')
    p.add_argument('--extra-deg', type=float, default=40.0,
                   help='hard-iron offset that adds about this much heading error to the orientation fault')
    p.add_argument('--bowl', choices=('wind', 'compass'), default='compass',
                   help='compass: the mis-oriented compass fault; wind: a rotating-wind spiral (pipeline check)')
    p.add_argument('--wind-start', type=float, default=4.0, help='wind bowl: start speed m/s')
    p.add_argument('--wind-rate', type=float, default=1.0, help='wind bowl: speed growth m/s per s')
    p.add_argument('--wind-max', type=float, default=25.0, help='wind bowl: speed cap m/s')
    p.add_argument('--ui-cancel-flag', help='scenario C: create this file so the Playwright watcher clicks 取り消し')
    p.add_argument('--out', required=True)
    a = p.parse_args()
    refuse_dev_stack(a)
    run = Scenarios(a)
    results = {}
    try:
        for s in a.scenarios.split(','):
            run.log('scenario', name=s)
            results[s] = getattr(run, f'scenario_{s.strip().lower()}')()
            run.log('result', name=s, **results[s])
        run.set_fault(False)
    finally:
        run.rc.stop.set()
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump({'airframe': 'copter' if run.copter else 'quadplane', 'results': results,
                       'events': run.events}, f, ensure_ascii=False, indent=1)
    sys.exit(0 if results and all(r.get('pass') for r in results.values()) else 1)


if __name__ == '__main__':
    main()
