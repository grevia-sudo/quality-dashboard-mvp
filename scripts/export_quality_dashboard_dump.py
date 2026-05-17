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

    dump_cmd = [
        'mysqldump',
        '--single-transaction',
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

    with OUTPUT_SQL.open('wb') as fh:
        result = subprocess.run(dump_cmd, stdout=fh, stderr=subprocess.PIPE, env=env, check=False)

    if result.returncode != 0:
        try:
            OUTPUT_SQL.unlink(missing_ok=True)
        except TypeError:
            if OUTPUT_SQL.exists():
                OUTPUT_SQL.unlink()
        sys.stderr.write(result.stderr.decode('utf-8', errors='replace'))
        return result.returncode

    size = OUTPUT_SQL.stat().st_size
    if size > COMPRESS_THRESHOLD_BYTES:
        with OUTPUT_SQL.open('rb') as src, gzip.open(OUTPUT_GZ, 'wb', compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        OUTPUT_SQL.unlink()
        final_path = OUTPUT_GZ
    else:
        final_path = OUTPUT_SQL

    print(str(final_path))
    print(final_path.stat().st_size)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
