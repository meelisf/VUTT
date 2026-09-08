"""Written historical dates retain precision and calendar; search uses inclusive bounds."""
import pytest
from server.work_dating import clean_dating, dating_updates, index_dating, parse_dating_text
from server.meili_doc import get_work_metadata
import json


def test_legacy_letter_range_and_index(tmp_path):
    meta = {'id': 'letter', 'year': 1803, 'year_display': '17-05-1803 - 17-05-1804'}
    (tmp_path / '_metadata.json').write_text(json.dumps(meta))
    _, doc = get_work_metadata(str(tmp_path), 'letter', {})
    assert (doc['date_start'], doc['date_end'], doc['year_start'], doc['year_end']) == (18030517, 18040517, 1803, 1804)
    assert doc['dating']['source_text'] == meta['year_display']
    assert json.loads((tmp_path / '_metadata.json').read_text()) == meta


def test_precision_survives_indexing():
    d = {'start': '1803-05', 'calendar': 'julian'}
    indexed = index_dating({'dating': d}, None)
    assert indexed['dating'] == d
    assert (indexed['date_start'], indexed['date_end']) == (18030501, 18030531)
    assert indexed['date_sort'] == 18030501
    assert index_dating({'year': 1803}, (1803, 1803))['date_end'] == 18031231


def test_calendar_is_optional_and_not_converted():
    for calendar in [None, 'julian', 'gregorian']:
        d = {'start': '1803-05-15', **({'calendar': calendar} if calendar else {})}
        assert index_dating({'dating': d}, None)['date_start'] == 18030515
        assert clean_dating(d) == d
    assert clean_dating({'start': '1712-02-30'})['start'] == '1712-02-30'
    assert clean_dating({'start': '1712-02-30', 'calendar': 'swedish'})['start'] == '1712-02-30'
    assert clean_dating({'start': '1700-02-29', 'calendar': 'julian'})['start'] == '1700-02-29'


@pytest.mark.parametrize('d', [
    {'start': '1803-02-29'}, {'start': '1803-13'}, {'start': '0000'},
    {'start': '1804', 'end': '1803'}, {'start': '1803', 'end': ''},
    {'start': '1700-02-29', 'calendar': 'gregorian'},
    {'start': '1700-02-29', 'calendar': 'swedish'},
    {'start': '1803-05', 'calendar': 'invented'}, {'start': '1803', 'approximate': 'yes'},
])
def test_invalid_structured_dates_rejected(d):
    with pytest.raises(ValueError):
        clean_dating(d)


def test_unknown_prose_stays_unparsed():
    assert parse_dating_text('31. dets.1812 - 9. jaan.1823; 7 k. s.d.') is None
    assert parse_dating_text('31.02.1803') is None


def test_edit_derives_legacy_fields_and_preserves_source():
    d = {'start': '1803-05-15', 'end': '1804-06-15', 'kind': 'uncertain', 'source_text': 'original', 'note': 'research note'}
    result = dating_updates({'dating': d, 'year': 9999})
    assert result == {'dating': d, 'year': 1803, 'year_display': '1803-05-15 / 1804-06-15'}
    assert dating_updates({'title': 'other edit'}) == {'title': 'other edit'}
    assert dating_updates({'dating': None, 'year': 0, 'year_display': None})['dating'] is None
