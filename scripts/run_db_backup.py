#!/usr/bin/env python3
from __future__ import annotations

import gzip
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

OUTPUT_SQL = Path('/home/ubuntu/quality_dashboard_full_dump.sql')
OUTPUT_GZ = Path('/home/ubuntu/quality_dashboard_full_dump.sql.gz')
COMPRESS_THRESHOLD_BYTES = 20 * 1024 * 1024


def main() -> int:
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print('DATABASE_URL is missing', file=sys.stderr)
        return 1

    parsed = urlparse(database_url)
    if parsed.scheme not in {'mysql', 'mysql2', 'mariadb'}:
        print(f'Unsupported DATABASE_URL scheme: {parsed.scheme}', file=sys.stderr)
        return 1

    host = parsed.hostname
    port = parsed.port or 3306
    username = unquote(parsed.username or '')
    password = unquote(parsed.password or '')
    database = parsed.path.lstrip('/')

    if not host or not username or not database:
        print('DATABASE_URL does not contain host/username/database', file=sys.stderr)
        return 1

    OUTPUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT_SQL.exists():
        OUTPUT_SQL.unlink()
    if OUTPUT_GZ.exists():
        OUTPUT_GZ.unlink()

    base_cmd = [
        'mysqldump',
        '--routines',
        '--triggers',
        '--events',
        '--default-character-set=utf8mb4',
        '--set-gtid-purged=OFF',
        '--no-tablespaces',
        '-h',
        host,
        '-P',
        str(port),
        '-u',
        username,
        database,
    ]

    env = os.environ.copy()
    env['MYSQL_PWD'] = password

    attempts = [
        ['--single-transaction', *base_cmd[1:]],
        ['--skip-lock-tables', *base_cmd[1:]],
    ]

    result = None
    error_messages = []
    for extra_cmd in attempts:
        dump_cmd = [base_cmd[0], *extra_cmd]
        with OUTPUT_SQL.open('wb') as fh:
            result = subprocess.run(dump_cmd, stdout=fh, stderr=subprocess.PIPE, env=env, check=False)
        if result.returncode == 0:
            break
        error_messages.append(result.stderr.decode('utf-8', errors='replace'))
        if OUTPUT_SQL.exists():
            OUTPUT_SQL.unlink()

    if result is None or result.returncode != 0:
        sys.stderr.write('\n--- retry ---\n'.join(error_messages))
        return 1

    size = OUTPUT_SQL.stat().st_size
    final_path = OUTPUT_SQL
    if size > COMPRESS_THRESHOLD_BYTES:
        with OUTPUT_SQL.open('rb') as src, gzip.open(OUTPUT_GZ, 'wb', compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        OUTPUT_SQL.unlink()
        final_path = OUTPUT_GZ

    print(str(final_path))
    print(final_path.stat().st_size)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
