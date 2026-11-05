"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const exec = promisify(execFile);
const array = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
async function readModel(file) {
  const stat = await fs.stat(file);
  if (stat.size > 8 * 1024 * 1024) throw new Error("模型文件不能超过 8 MB");
  const text = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".cfg") return { text, ext, choices: [] };
  if (![".icd", ".cid", ".scd", ".iid"].includes(ext))
    throw new Error("支持 ICD / CID / SCD / IID / CFG");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("不允许含 DOCTYPE / 外部实体的 SCL 文件");
  const valid = XMLValidator.validate(text);
  if (valid !== true)
    throw new Error(`XML 第 ${valid.err.line} 行：${valid.err.msg}`);
  const xml = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
  }).parse(text);
  if (!xml.SCL) throw new Error("文件缺少 SCL 根节点");
  const choices = [];
  for (const ied of array(xml.SCL.IED))
    for (const ap of array(ied.AccessPoint))
      if (ap.Server) choices.push({ ied: ied["@_name"], ap: ap["@_name"] });
  if (!choices.length)
    throw new Error("SCL 中没有包含 Server 的 IED / AccessPoint");
  return { text, ext, choices };
}
function checkCfg(cfg) {
  if (cfg.length > 8 * 1024 * 1024 || !/^\s*MODEL(?:\(|\{)/.test(cfg))
    throw new Error("不是 libiec61850 MODEL 格式的 CFG");
  for (const [i, line] of cfg.split(/\r?\n/).entries())
    if (Buffer.byteLength(line) > 1000)
      throw new Error(`CFG 第 ${i + 1} 行超过协议库解析上限`);
  let depth = 0;
  for (const c of cfg.replace(/"[^"\r\n]*"/g, '""')) {
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth < 0 || depth > 64) throw new Error("CFG 括号或模型层次不合法");
  }
  if (depth !== 0) throw new Error("CFG 大括号不匹配");
}
async function convertModel(input, choice, { directory, jar, binary }) {
  await fs.mkdir(directory, { recursive: true });
  let cfg = input.text,
    diagnostics = "";
  if (input.ext !== ".cfg") {
    if (
      !input.choices.some((c) => c.ied === choice?.ied && c.ap === choice?.ap)
    )
      throw new Error("请选择有效的 IED 与访问点");
    const source = path.join(directory, "source.scl"),
      output = path.join(directory, "model.cfg");
    await fs.writeFile(source, input.text, "utf8");
    try {
      const result = await exec(
        process.env.JAVA_HOME
          ? path.join(process.env.JAVA_HOME, "bin/java.exe")
          : "java",
        [
          "-Dfile.encoding=UTF-8",
          "-jar",
          jar,
          source,
          "-ied",
          choice.ied,
          "-ap",
          choice.ap,
          output,
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
      );
      diagnostics = (result.stdout + "\n" + result.stderr).trim();
      if (/ERROR:|Exception/i.test(result.stderr))
        throw new Error(result.stderr);
      cfg = await fs.readFile(output, "utf8");
    } catch (e) {
      throw new Error(
        `SCL 转换失败。需要 Java 17+（JAVA_HOME 或 PATH）。\n${e.stderr || e.message}`,
      );
    }
  }
  checkCfg(cfg);
  const target = path.join(directory, "validated.cfg");
  await fs.writeFile(target, cfg, "utf8");
  try {
    await exec(binary, ["--validate", target], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    throw new Error(`libiec61850 拒绝此模型：${e.stderr || e.message}`);
  }
  return { cfg, diagnostics };
}
module.exports = { readModel, checkCfg, convertModel };
