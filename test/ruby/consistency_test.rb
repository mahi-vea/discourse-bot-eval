# frozen_string_literal: true

# Cross-checks between about.json, settings.yml, locales/en.yml and the script
# that uses them. These are the mistakes that ship silently as a blank setting
# description or a "translation missing" in the bar.
require "minitest/autorun"
require "yaml"
require "json"

class ConsistencyTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)

  ABOUT = JSON.parse(File.read(File.join(ROOT, "about.json")))
  SETTINGS = YAML.load_file(File.join(ROOT, "settings.yml"))
  LOCALE = YAML.load_file(File.join(ROOT, "locales/en.yml")).fetch("en")
  SCRIPT = File.read(File.join(ROOT, "javascripts/discourse/api-initializers/bot-eval.js"))

  MODES = %w[up down review].freeze

  def dig_key(tree, key)
    key.split(".").reduce(tree) { |node, part| node.is_a?(Hash) ? node[part] : nil }
  end

  def test_it_declares_itself_a_theme_component
    assert_equal true, ABOUT["component"], "without this it installs as a whole theme"
    refute_empty ABOUT["name"].to_s
  end

  def test_every_setting_is_explained_to_the_admin
    described = LOCALE.dig("theme_metadata", "settings") || {}

    SETTINGS.each_key do |name|
      refute_nil described[name], "settings.yml has #{name} but locales/en.yml does not explain it"
      refute_empty described[name].to_s.strip
    end
  end

  def test_no_explanation_is_left_behind_for_a_removed_setting
    (LOCALE.dig("theme_metadata", "settings") || {}).each_key do |name|
      assert SETTINGS.key?(name), "locales/en.yml explains #{name}, which settings.yml no longer has"
    end
  end

  def test_it_is_inert_until_an_admin_names_a_bot_and_a_group
    assert_equal "", SETTINGS.dig("bot_usernames", "default").to_s
    assert_equal "", SETTINGS.dig("evaluator_groups", "default").to_s
  end

  def test_every_setting_the_script_reads_exists
    SCRIPT.scan(/settings\.(\w+)/).flatten.uniq.each do |name|
      assert SETTINGS.key?(name), "the script reads settings.#{name}, which settings.yml does not define"
    end
  end

  def test_every_literal_message_the_script_asks_for_exists
    keys = SCRIPT.scan(/\bt\("([^"]+)"/).flatten.uniq

    refute_empty keys
    keys.each do |key|
      refute_nil dig_key(LOCALE, "bot_eval.#{key}"), "#{key} is used but missing from locales/en.yml"
    end
  end

  def test_the_per_action_messages_cover_every_action_that_uses_them
    MODES.each do |mode|
      %w[hint hint_solution placeholder].each do |group|
        refute_nil dig_key(LOCALE, "bot_eval.#{group}.#{mode}"), "bot_eval.#{group}.#{mode} is missing"
      end
    end

    # A thumbs up never needs a stand-in note: its note is optional and simply
    # omitted, whereas a flag must carry a message.
    %w[down review].each do |mode|
      refute_nil dig_key(LOCALE, "bot_eval.no_note.#{mode}"), "bot_eval.no_note.#{mode} is missing"
    end
  end

  def test_the_flag_stand_in_messages_are_long_enough_for_discourse_to_accept
    %w[down review].each do |mode|
      message = dig_key(LOCALE, "bot_eval.no_note.#{mode}").to_s
      assert_operator message.length, :>=, 10, "Discourse rejects a flag message this short"
    end
  end

  def test_it_only_ever_writes_through_discourses_own_api
    urls = SCRIPT.scan(%r{ajax\(\s*[`"]([^`"]+)}).flatten

    refute_empty urls
    urls.each do |url|
      assert url.start_with?("/"), "#{url} is not a Discourse path - nothing should leave the forum"
    end
  end
end
