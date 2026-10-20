#!/usr/bin/env python3
"""Sample CPU and memory of a macOS app, summed over its whole process family.

  scripts/footprint.py slim --duration 60
  scripts/footprint.py Spotify --launch --quit --label idle

Why this exists: both slim (Tauri, UI in WebKit helper processes) and Spotify (Chromium, many
"Helper" processes) are several processes, so looking at one row in Activity Monitor undercounts.

- CPU:  derived from the processes' accumulated CPU time (`ps cputime`), so it is the real
        average over each interval (`ps %cpu` is a decaying average and unusable).
        100% = one fully busy core; a multi-threaded app can exceed 100%.
- Memory: `footprint` (phys_footprint), the number Activity Monitor shows as "Memory".
        RSS is also printed for reference, but it counts shared pages in every process.
- Keep the app's window visible (not minimised or covered) while measuring; hidden windows are throttled.
- Process family:
    Spotify -> every process inside Spotify.app
    slim    -> slim itself plus the three com.apple.WebKit.* helpers (GPU, Networking,
               WebContent) that were started in the same second by launchd. If an unrelated app
               launched a WebKit view in that very second it would be counted too; the process
               count is printed so that is easy to spot.
"""
import argparse
import json
import re
import statistics
import subprocess
import sys
import time

PS_LINE = re.compile(r"\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$")


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def parse_cputime(s):
    """[[dd-]hh:]mm:ss.cc -> seconds"""
    days = 0
    if "-" in s:
        d, s = s.split("-", 1)
        days = int(d)
    parts = s.split(":")
    secs = float(parts[-1])
    for mult, p in zip((60, 3600), reversed(parts[:-1])):
        secs += int(p) * mult
    return days * 86400 + secs


def ps_table():
    rows = []
    for line in sh("ps", "-axo", "pid=,ppid=,cputime=,rss=,lstart=,comm=").splitlines():
        m = PS_LINE.match(line)
        if not m:
            continue
        pid, ppid, cpu, rss, started, comm = m.groups()
        rows.append({
            "pid": int(pid), "ppid": int(ppid), "cpu": parse_cputime(cpu), "rss_kb": int(rss),
            "start": time.mktime(time.strptime(re.sub(r"\s+", " ", started), "%a %b %d %H:%M:%S %Y")),
            "comm": comm,
        })
    return rows


def short(comm):
    name = comm.rsplit("/", 1)[-1]
    return name.replace("com.apple.WebKit.", "WebKit ")


def family(rows, app):
    if app.lower() == "slim":
        mains = [r for r in rows if r["comm"].endswith("/slim.app/Contents/MacOS/slim")]
        if not mains:
            return []
        main = max(mains, key=lambda r: r["start"])  # newest instance if several
        helpers = [r for r in rows
                   if "com.apple.WebKit." in r["comm"] and r["ppid"] == 1 and abs(r["start"] - main["start"]) <= 3]
        return [main] + helpers
    return [r for r in rows if f"/{app}.app/" in r["comm"]]


UNITS = {"KB": 1 / 1024, "MB": 1.0, "GB": 1024.0}


def footprint_mb(pids):
    """Returns ({pid: MB}, failed_count)."""
    if not pids:
        return {}, 0
    args = ["footprint", "--noCategories"]
    for p in pids:
        args += ["-p", str(p)]
    out = sh(*args)
    result = {}
    for m in re.finditer(r"\[(\d+)\]: .*?Footprint:\s+([\d.]+)\s+(KB|MB|GB)", out):
        result[int(m.group(1))] = float(m.group(2)) * UNITS[m.group(3)]
    return result, len(pids) - len(result)


def audio_outputs():
    """Number of active audio-out contexts macOS reports. Compare with a baseline taken while the
    app is idle: an app that is really playing adds one. (pmset attributes them to coreaudiod,
    not to the app, so this proves 'something started playing', not who.)"""
    return sh("pmset", "-g", "assertions").count("Resources: audio-out")


def wait_for(app, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if family(ps_table(), app):
            return True
        time.sleep(0.5)
    return False


def pct(values, q):
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app", help="app name, e.g. slim or Spotify")
    ap.add_argument("--duration", type=float, default=60, help="seconds to sample (default 60)")
    ap.add_argument("--interval", type=float, default=3, help="seconds between samples (default 3)")
    ap.add_argument("--settle", type=float, default=0, help="seconds to wait before sampling (after --launch)")
    ap.add_argument("--launch", action="store_true", help="launch the app if it isn't running")
    ap.add_argument("--restart", action="store_true", help="quit the app first if it is running, then launch it fresh")
    ap.add_argument("--background", action="store_true",
                    help="launch without bringing the window to the front (not recommended: hidden windows get throttled)")
    ap.add_argument("--quit", action="store_true", help="quit the app afterwards, only if this script launched it")
    ap.add_argument("--label", default="", help="free text stored in the output, e.g. idle / playing")
    ap.add_argument("--json", metavar="FILE", help="also write the raw samples and summary to FILE")
    a = ap.parse_args()

    launched = False
    if a.restart and family(ps_table(), a.app):
        sh("osascript", "-e", f'quit app "{a.app}"')
        for _ in range(60):
            if not family(ps_table(), a.app):
                break
            time.sleep(0.5)
        else:
            sys.exit(f"{a.app} did not quit within 30 s")
        time.sleep(2)  # let helper processes and the OS settle
    if not family(ps_table(), a.app):
        if not (a.launch or a.restart):
            sys.exit(f"{a.app} is not running (use --launch)")
        # Foreground by default: WebKit and Chromium throttle rendering for occluded windows,
        # which would make the numbers look better than they are in real use.
        sh("open", *(["-g"] if a.background else []), "-a", a.app)
        launched = True
        if not wait_for(a.app, 30):
            sys.exit(f"{a.app} did not start within 30 s")
    if a.settle:
        print(f"settling {a.settle:.0f}s ...", file=sys.stderr)
        time.sleep(a.settle)

    samples = []
    prev = {r["pid"]: r["cpu"] for r in family(ps_table(), a.app)}
    prev_t = time.monotonic()
    started = prev_t
    last_family = []
    while time.monotonic() - started < a.duration:
        time.sleep(a.interval)
        fam = family(ps_table(), a.app)
        now = time.monotonic()
        if not fam:
            sys.exit(f"{a.app} exited during the measurement")
        # CPU seconds used since the previous sample; a process that appeared since then
        # contributes everything it has used so far.
        used = sum(r["cpu"] - prev.get(r["pid"], 0.0) for r in fam)
        cpu = max(0.0, used) / (now - prev_t) * 100
        mem, failed = footprint_mb([r["pid"] for r in fam])
        samples.append({
            "t": round(now - started, 1), "cpu_pct": round(cpu, 2), "procs": len(fam),
            "footprint_mb": round(sum(mem.values()), 1), "footprint_failed": failed,
            "rss_mb": round(sum(r["rss_kb"] for r in fam) / 1024, 1),
            "audio_outputs": audio_outputs(),
        })
        prev = {r["pid"]: r["cpu"] for r in fam}
        prev_t = time.monotonic()
        last_family = [(r, mem.get(r["pid"])) for r in fam]

    cpus = [s["cpu_pct"] for s in samples]
    fps = [s["footprint_mb"] for s in samples]
    summary = {
        "app": a.app, "label": a.label, "samples": len(samples), "interval_s": a.interval,
        "duration_s": samples[-1]["t"] if samples else 0,
        "processes_median": statistics.median(s["procs"] for s in samples),
        "cpu_pct": {"mean": round(statistics.mean(cpus), 2), "median": round(statistics.median(cpus), 2),
                    "p95": round(pct(cpus, 0.95), 2), "max": round(max(cpus), 2)},
        "footprint_mb": {"mean": round(statistics.mean(fps), 1), "max": round(max(fps), 1), "last": fps[-1]},
        "rss_mb_mean": round(statistics.mean(s["rss_mb"] for s in samples), 1),
        "footprint_unreadable_processes_max": max(s["footprint_failed"] for s in samples),
        "audio_outputs": [min(s["audio_outputs"] for s in samples), max(s["audio_outputs"] for s in samples)],
    }

    print(f"\n{a.app}{' [' + a.label + ']' if a.label else ''}: {summary['samples']} samples over "
          f"{summary['duration_s']:.0f}s, {summary['processes_median']:.0f} processes")
    c, m = summary["cpu_pct"], summary["footprint_mb"]
    print(f"  CPU    mean {c['mean']:.1f}%   median {c['median']:.1f}%   p95 {c['p95']:.1f}%   max {c['max']:.1f}%   (100% = one core)")
    print(f"  Memory mean {m['mean']:.0f} MB   max {m['max']:.0f} MB   (phys footprint; RSS sum {summary['rss_mb_mean']:.0f} MB overcounts shared pages)")
    lo, hi = summary["audio_outputs"]
    print(f"  audio-out contexts active: {lo}" + (f"-{hi}" if hi != lo else "") + "  (compare with the idle baseline)")
    if summary["footprint_unreadable_processes_max"]:
        print(f"  note: footprint could not read up to {summary['footprint_unreadable_processes_max']} process(es); memory is a lower bound")
    print("  largest processes at the end:")
    for r, mb in sorted(last_family, key=lambda x: -(x[1] or 0))[:6]:
        print(f"    {mb if mb is not None else float('nan'):7.0f} MB  pid {r['pid']:<6} {short(r['comm'])}")

    if a.json:
        with open(a.json, "w") as f:
            json.dump({"summary": summary, "samples": samples}, f, indent=1)

    if launched and a.quit:
        sh("osascript", "-e", f'quit app "{a.app}"')


if __name__ == "__main__":
    main()
