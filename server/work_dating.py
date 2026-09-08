"""Source-calendar dates. Index keys order written dates, never converted instants."""
import re


def partial_date(value, calendar=None):
    if not isinstance(value, str) or not re.fullmatch(r'\d{3,4}(?:-\d{2}(?:-\d{2})?)?', value):
        return None
    parts = [int(v) for v in value.split('-')]
    y, m, d = (parts + [None, None])[:3]
    if y < 1 or (m is not None and not 1 <= m <= 12):
        return None
    leap = not (calendar == 'swedish' and y == 1700) and y % 4 == 0 and (calendar != 'gregorian' or y % 100 != 0 or y % 400 == 0)
    days = (30 if calendar in (None, 'swedish') and y == 1712 else 29 if leap else 28) if m == 2 else 30 if m in (4, 6, 9, 11) else 31
    if d is not None and not 1 <= d <= days:
        return None
    return parts


def bound(value, upper=False):
    parts = partial_date(value)
    if not parts:
        return None
    y, m, d = (parts + [None, None])[:3]
    return y * 10000 + (m or (12 if upper else 1)) * 100 + (d or (31 if upper else 1))


def parse_dating_text(raw):
    s = str(raw or '').strip()
    def endpoint(v):
        if partial_date(v):
            return v
        match = re.fullmatch(r'(\d{1,2})[.-](\d{1,2})[.-](\d{4})', v)
        if match:
            d, m, y = match.groups()
            iso = f'{y}-{int(m):02}-{int(d):02}'
            if partial_date(iso):
                return iso
        return None
    one = endpoint(s)
    if one:
        return {'start': one}
    pair = re.split(r'\s+[–—-]\s+|[–—/]', s)
    if len(pair) != 2:
        match = re.fullmatch(r'(\d{3,4})-(\d{3,4})', s)
        pair = list(match.groups()) if match else []
    if len(pair) == 2:
        start, end = [endpoint(v.strip()) for v in pair]
        if start and end and bound(start) <= bound(end, True):
            return {'start': start, 'end': end}
    return None


def clean_dating(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('Invalid dating')
    if 'end' in value and not value['end']:
        raise ValueError('Invalid dating end')
    allowed = {'start', 'end', 'kind', 'calendar', 'approximate', 'note', 'source_text'}
    result = {k: v for k, v in value.items() if k in allowed and v not in (None, '')}
    calendar = result.get('calendar')
    if calendar not in (None, 'julian', 'gregorian', 'swedish'):
        raise ValueError('Invalid dating calendar')
    if result.get('kind') not in (None, 'span', 'uncertain'):
        raise ValueError('Invalid dating kind')
    if 'approximate' in result and not isinstance(result['approximate'], bool):
        raise ValueError('Invalid dating approximation')
    if any(not isinstance(result[k], str) for k in ('note', 'source_text') if k in result):
        raise ValueError('Invalid dating text')
    if not partial_date(result.get('start'), calendar):
        raise ValueError('Invalid dating start')
    end = result.get('end')
    if end is not None and (not partial_date(end, calendar) or bound(result['start']) > bound(end, True)):
        raise ValueError('Invalid dating end')
    return result


def dating_updates(updates):
    """Explicit dating edits own legacy compatibility fields; omission preserves them."""
    if 'dating' not in updates:
        return updates
    result = dict(updates)
    value = clean_dating(result['dating'])
    result['dating'] = value
    if value:
        start, end = value['start'], value.get('end')
        result['year'] = (int(start.split('-')[0]) + int((end or start).split('-')[0])) // 2
        result['year_display'] = start + (' / ' + end if end else '')
    return result


def index_dating(meta, year_range):
    value = meta.get('dating')
    if value:
        value = clean_dating(value)
    else:
        value = parse_dating_text(meta.get('year_display'))
        if value:
            value['source_text'] = meta['year_display']
    if value:
        start = bound(value['start'])
        end = bound(value.get('end') or value['start'], True)
    elif year_range:
        start, end = year_range[0] * 10000 + 101, year_range[1] * 10000 + 1231
    else:
        start = end = 0
    return {'dating': value, 'date_start': start, 'date_end': end, 'date_sort': start}
